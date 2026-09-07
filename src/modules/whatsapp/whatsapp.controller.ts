import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Public } from '../../common/decorators';
import { WhatsappService } from './whatsapp.service';

@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {}

  /** Meta's one-time subscription handshake. */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = this.config.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && expected && token === expected) {
      this.logger.log('WhatsApp webhook verified');
      return challenge;
    }
    throw new ForbiddenException('Webhook verification failed');
  }

  /**
   * Always answers 200 immediately: Meta retries anything else, and a retry
   * storm is worse than a dropped event we can already replay from the ledger.
   */
  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    this.assertSignature(request);
    // Processing is intentionally not awaited - Meta expects a fast 200.
    void this.whatsapp.processWebhook(body).catch((error) => {
      this.logger.error(`Webhook processing failed: ${(error as Error).message}`);
    });
    return { received: true };
  }

  /**
   * Verifies X-Hub-Signature-256 over the exact bytes Meta sent. Without this,
   * anyone who learns the URL could inject messages into any office.
   */
  private assertSignature(request: Request & { rawBody?: Buffer }): void {
    const appSecret = this.config.get<string>('whatsapp.appSecret');
    if (!appSecret) {
      this.logger.warn('WHATSAPP_APP_SECRET is not set - webhook signatures are not verified');
      return;
    }

    const header = request.headers['x-hub-signature-256'];
    if (typeof header !== 'string' || !header.startsWith('sha256=')) {
      throw new BadRequestException('Missing webhook signature');
    }
    if (!request.rawBody) {
      throw new BadRequestException('Raw body unavailable for signature verification');
    }

    const expected = createHmac('sha256', appSecret).update(request.rawBody).digest();
    const received = Buffer.from(header.slice('sha256='.length), 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
