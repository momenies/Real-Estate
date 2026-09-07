import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface SendResult {
  waMessageId: string | null;
  ok: boolean;
  error?: string;
}

/** Meta's own limits - exceeding any of them rejects the whole message. */
const BUTTON_TITLE_MAX = 20;
const LIST_TITLE_MAX = 24;
const LIST_DESCRIPTION_MAX = 72;
const BODY_MAX = 1024;
const MAX_BUTTONS = 3;
const MAX_LIST_ROWS = 10;

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/**
 * Thin, typed client over the WhatsApp Cloud API.
 *
 * Going through Meta's official Cloud API rather than an unofficial library is
 * what keeps the office's number from being banned, which is the whole reason
 * the owner trusts the platform with it.
 */
@Injectable()
export class WhatsappApiService {
  private readonly logger = new Logger(WhatsappApiService.name);
  private readonly http: AxiosInstance;
  private readonly apiVersion: string;

  constructor(private readonly config: ConfigService) {
    this.apiVersion = this.config.get<string>('whatsapp.apiVersion') ?? 'v21.0';
    this.http = axios.create({
      baseURL: `${this.config.get<string>('whatsapp.graphBaseUrl')}/${this.apiVersion}`,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${this.config.get<string>('whatsapp.accessToken')}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private async send(phoneNumberId: string, payload: object): Promise<SendResult> {
    const numberId = phoneNumberId || (this.config.get<string>('whatsapp.defaultPhoneNumberId') ?? '');
    try {
      const { data } = await this.http.post(`/${numberId}/messages`, {
        messaging_product: 'whatsapp',
        ...payload,
      });
      return { waMessageId: data?.messages?.[0]?.id ?? null, ok: true };
    } catch (error) {
      const detail = isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : (error as Error).message;
      this.logger.error(`WhatsApp send failed: ${detail}`);
      return { waMessageId: null, ok: false, error: detail };
    }
  }

  sendText(phoneNumberId: string, to: string, body: string, previewUrl = false): Promise<SendResult> {
    return this.send(phoneNumberId, {
      to,
      type: 'text',
      text: { body: clip(body, 4096), preview_url: previewUrl },
    });
  }

  sendImage(phoneNumberId: string, to: string, link: string, caption?: string) {
    return this.send(phoneNumberId, {
      to,
      type: 'image',
      image: { link, caption: caption ? clip(caption, BODY_MAX) : undefined },
    });
  }

  sendVideo(phoneNumberId: string, to: string, link: string, caption?: string) {
    return this.send(phoneNumberId, {
      to,
      type: 'video',
      video: { link, caption: caption ? clip(caption, BODY_MAX) : undefined },
    });
  }

  sendLocation(
    phoneNumberId: string,
    to: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
  ) {
    return this.send(phoneNumberId, {
      to,
      type: 'location',
      location: { latitude, longitude, name, address },
    });
  }

  /** Up to three quick-reply buttons - the entire UI the office owner needs. */
  sendButtons(
    phoneNumberId: string,
    to: string,
    body: string,
    buttons: ReplyButton[],
    header?: string,
    footer?: string,
  ) {
    return this.send(phoneNumberId, {
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(header ? { header: { type: 'text', text: clip(header, 60) } } : {}),
        body: { text: clip(body, BODY_MAX) },
        ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
        action: {
          buttons: buttons.slice(0, MAX_BUTTONS).map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: clip(button.title, BUTTON_TITLE_MAX) },
          })),
        },
      },
    });
  }

  /** A single-select list, for choices that do not fit in three buttons. */
  sendList(
    phoneNumberId: string,
    to: string,
    body: string,
    buttonLabel: string,
    rows: ListRow[],
    header?: string,
  ) {
    return this.send(phoneNumberId, {
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(header ? { header: { type: 'text', text: clip(header, 60) } } : {}),
        body: { text: clip(body, BODY_MAX) },
        action: {
          button: clip(buttonLabel, BUTTON_TITLE_MAX),
          sections: [
            {
              title: clip(header ?? 'الخيارات', LIST_TITLE_MAX),
              rows: rows.slice(0, MAX_LIST_ROWS).map((row) => ({
                id: row.id,
                title: clip(row.title, LIST_TITLE_MAX),
                ...(row.description
                  ? { description: clip(row.description, LIST_DESCRIPTION_MAX) }
                  : {}),
              })),
            },
          ],
        },
      },
    });
  }

  /**
   * Templates are the only way to open a conversation outside Meta's 24-hour
   * customer-service window, so every broadcast to a quiet lead uses one.
   */
  sendTemplate(
    phoneNumberId: string,
    to: string,
    templateName: string,
    languageCode: string,
    components?: unknown[],
  ) {
    return this.send(phoneNumberId, {
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components ? { components } : {}),
      },
    });
  }

  async markAsRead(phoneNumberId: string, waMessageId: string): Promise<void> {
    await this.send(phoneNumberId, { status: 'read', message_id: waMessageId });
  }

  /** Media ids are short-lived; resolve then download in one go. */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const { data: meta } = await this.http.get(`/${mediaId}`);
      if (!meta?.url) return null;
      const { data } = await axios.get<ArrayBuffer>(meta.url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        headers: { Authorization: `Bearer ${this.config.get<string>('whatsapp.accessToken')}` },
      });
      return { buffer: Buffer.from(data), mimeType: meta.mime_type ?? 'application/octet-stream' };
    } catch (error) {
      this.logger.error(`Failed to download media ${mediaId}: ${(error as Error).message}`);
      return null;
    }
  }

  assertConfigured(): void {
    if (!this.config.get<string>('whatsapp.accessToken')) {
      throw new HttpException('WhatsApp Cloud API is not configured', 503);
    }
  }
}
