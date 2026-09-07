import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { WhatsappApiService } from '../whatsapp/whatsapp-api.service';

export interface StoredMedia {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

/**
 * WhatsApp media ids expire, so anything the owner sends is mirrored into our
 * own bucket immediately. Those permanent URLs are what later feed re-sends,
 * TikTok publishing and the Haraj copy-paste package.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappApiService,
  ) {}

  get enabled(): boolean {
    return (
      this.config.get<string>('storage.provider') === 'supabase' &&
      !!this.config.get<string>('storage.supabaseUrl') &&
      !!this.config.get<string>('storage.supabaseServiceKey')
    );
  }

  async mirrorWhatsappMedia(
    officeId: string,
    propertyId: string,
    mediaId: string,
  ): Promise<StoredMedia | null> {
    const downloaded = await this.whatsapp.downloadMedia(mediaId);
    if (!downloaded) return null;

    const extension = EXTENSIONS[downloaded.mimeType] ?? 'bin';
    const key = `${officeId}/${propertyId}/${randomUUID()}.${extension}`;

    if (!this.enabled) {
      // Without a bucket configured the platform still runs; media simply stays
      // referenced by its WhatsApp id until storage is set up.
      this.logger.warn('Storage is not configured - media was fetched but not persisted');
      return null;
    }

    const uploaded = await this.uploadToSupabase(key, downloaded.buffer, downloaded.mimeType);
    if (!uploaded) return null;

    return {
      storageKey: key,
      url: uploaded,
      mimeType: downloaded.mimeType,
      sizeBytes: downloaded.buffer.length,
    };
  }

  private async uploadToSupabase(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string | null> {
    const baseUrl = this.config.get<string>('storage.supabaseUrl');
    const serviceKey = this.config.get<string>('storage.supabaseServiceKey');
    const bucket = this.config.get<string>('storage.bucket');

    try {
      await axios.post(`${baseUrl}/storage/v1/object/${bucket}/${key}`, buffer, {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        maxBodyLength: Infinity,
        timeout: 60_000,
      });
      return `${baseUrl}/storage/v1/object/public/${bucket}/${key}`;
    } catch (error) {
      this.logger.error(`Supabase upload failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }
}
