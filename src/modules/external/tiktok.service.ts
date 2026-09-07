import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalPlatform, MediaType, PublicationStatus } from '@prisma/client';
import axios from 'axios';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { DEAL_LABELS, TYPE_LABELS, formatSar } from '../whatsapp/messages';

/**
 * Official TikTok integration.
 *
 * The office signs in once with OAuth; after that the platform holds a
 * refreshable token and publishes the property video through the official
 * Content Posting API. Nothing here automates a logged-in session, which is
 * exactly what gets accounts banned.
 */
@Injectable()
export class TiktokService {
  private readonly logger = new Logger(TiktokService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly properties: PropertiesService,
  ) {}

  /**
   * Builds the consent URL. `state` is signed so the callback can be trusted to
   * name the office that started the flow - it is the CSRF defence for OAuth.
   */
  buildAuthorizationUrl(officeId: string): { url: string; state: string } {
    const clientKey = this.config.get<string>('tiktok.clientKey');
    const redirectUri = this.config.get<string>('tiktok.redirectUri');
    if (!clientKey || !redirectUri) {
      throw new BadRequestException('TikTok integration is not configured');
    }

    const state = this.signState(officeId);
    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: 'code',
      scope: 'user.info.basic,video.publish,video.upload',
      redirect_uri: redirectUri,
      state,
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`, state };
  }

  async handleCallback(code: string, state: string) {
    const officeId = this.verifyState(state);
    const tokens = await this.exchangeCode(code);

    return this.prisma.externalAccount.upsert({
      where: { officeId_platform: { officeId, platform: ExternalPlatform.TIKTOK } },
      create: {
        officeId,
        platform: ExternalPlatform.TIKTOK,
        externalUserId: tokens.open_id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + tokens.refresh_expires_in * 1000),
        scopes: (tokens.scope ?? '').split(','),
      },
      update: {
        externalUserId: tokens.open_id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + tokens.refresh_expires_in * 1000),
        scopes: (tokens.scope ?? '').split(','),
      },
    });
  }

  /**
   * Publishes the property's video using PULL_FROM_URL, so TikTok fetches it
   * straight from our bucket instead of us re-uploading the bytes.
   */
  async publishProperty(officeId: string, propertyId: string) {
    const account = await this.prisma.externalAccount.findUnique({
      where: { officeId_platform: { officeId, platform: ExternalPlatform.TIKTOK } },
    });
    if (!account?.accessToken) {
      throw new BadRequestException('This office has not connected TikTok yet');
    }

    const property = await this.properties.getOrThrow(propertyId);
    const media = await this.properties.getMedia(propertyId);
    const video = media.find((item) => item.type === MediaType.VIDEO && item.url);
    if (!video?.url) {
      throw new BadRequestException('This property has no video to publish');
    }

    const caption = this.buildCaption(property);
    const publication = await this.prisma.externalPublication.create({
      data: {
        officeId,
        propertyId,
        accountId: account.id,
        platform: ExternalPlatform.TIKTOK,
        status: PublicationStatus.PUBLISHING,
        caption,
      },
    });

    try {
      const accessToken = await this.validAccessToken(officeId);
      const { data } = await axios.post(
        `${this.config.get<string>('tiktok.apiBaseUrl')}/v2/post/publish/video/init/`,
        {
          post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE' },
          source_info: { source: 'PULL_FROM_URL', video_url: video.url },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          timeout: 30_000,
        },
      );

      return this.prisma.externalPublication.update({
        where: { id: publication.id },
        data: {
          status: PublicationStatus.PUBLISHED,
          externalPostId: data?.data?.publish_id ?? null,
          publishedAt: new Date(),
          payload: data,
        },
      });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`TikTok publish failed for ${propertyId}: ${message}`);
      return this.prisma.externalPublication.update({
        where: { id: publication.id },
        data: { status: PublicationStatus.FAILED, error: message },
      });
    }
  }

  /** Refreshes the access token when it is close to expiry. */
  private async validAccessToken(officeId: string): Promise<string> {
    const account = await this.prisma.externalAccount.findUnique({
      where: { officeId_platform: { officeId, platform: ExternalPlatform.TIKTOK } },
    });
    if (!account?.accessToken) throw new BadRequestException('TikTok is not connected');

    const expiresSoon =
      !account.accessTokenExpiresAt ||
      account.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60_000;
    if (!expiresSoon || !account.refreshToken) return account.accessToken;

    const { data } = await axios.post(
      `${this.config.get<string>('tiktok.apiBaseUrl')}/v2/oauth/token/`,
      new URLSearchParams({
        client_key: this.config.get<string>('tiktok.clientKey') ?? '',
        client_secret: this.config.get<string>('tiktok.clientSecret') ?? '',
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000 },
    );

    await this.prisma.externalAccount.update({
      where: { id: account.id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? account.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });
    return data.access_token;
  }

  private async exchangeCode(code: string) {
    const { data } = await axios.post(
      `${this.config.get<string>('tiktok.apiBaseUrl')}/v2/oauth/token/`,
      new URLSearchParams({
        client_key: this.config.get<string>('tiktok.clientKey') ?? '',
        client_secret: this.config.get<string>('tiktok.clientSecret') ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.get<string>('tiktok.redirectUri') ?? '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000 },
    );
    return data;
  }

  private buildCaption(property: {
    propertyType: keyof typeof TYPE_LABELS;
    dealType: keyof typeof DEAL_LABELS;
    district: string | null;
    city: string | null;
    priceSar: number | null;
    areaSqm: number | null;
  }): string {
    const tags = ['#عقار', '#عقارات', property.city ? `#${property.city}` : '', '#للبيع']
      .filter(Boolean)
      .join(' ');
    return [
      `${TYPE_LABELS[property.propertyType]} ${DEAL_LABELS[property.dealType]}`,
      property.district ? `📍 ${property.district}` : '',
      `💰 ${formatSar(property.priceSar)}`,
      property.areaSqm ? `📐 ${property.areaSqm} م²` : '',
      '',
      tags,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private signState(officeId: string): string {
    const nonce = randomBytes(8).toString('hex');
    const payload = `${officeId}.${Date.now()}.${nonce}`;
    const signature = createHmac('sha256', this.stateSecret()).update(payload).digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64url');
  }

  private verifyState(state: string): string {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Malformed OAuth state');
    }

    const parts = decoded.split('.');
    if (parts.length !== 4) throw new BadRequestException('Malformed OAuth state');
    const [officeId, issuedAt, nonce, signature] = parts;

    const expected = createHmac('sha256', this.stateSecret())
      .update(`${officeId}.${issuedAt}.${nonce}`)
      .digest('hex');
    if (signature !== expected) throw new BadRequestException('OAuth state signature mismatch');
    if (Date.now() - Number.parseInt(issuedAt, 10) > 15 * 60_000) {
      throw new BadRequestException('OAuth state has expired');
    }
    return officeId;
  }

  private stateSecret(): string {
    return this.config.get<string>('jwtSecret') ?? 'state-secret';
  }
}
