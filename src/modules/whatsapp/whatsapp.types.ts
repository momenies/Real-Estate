import { MediaType } from '@prisma/client';

export type InboundKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'button_reply'
  | 'list_reply'
  | 'contacts'
  | 'unsupported';

export interface InboundMessage {
  /** Meta's message id - also our idempotency key. */
  waMessageId: string;
  /** The business number that received it; identifies the tenant. */
  phoneNumberId: string;
  /** The person who sent it, E.164 without '+'. */
  from: string;
  profileName?: string;
  timestamp: Date;
  kind: InboundKind;
  text?: string;
  /** Caption on an image or video - where owners usually type the price. */
  caption?: string;
  mediaId?: string;
  mimeType?: string;
  mediaType?: MediaType;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  locationAddress?: string;
  /** Payload of the tapped quick-reply button or selected list row. */
  replyId?: string;
  replyTitle?: string;
  raw: unknown;
}

export interface InboundStatus {
  waMessageId: string;
  phoneNumberId: string;
  recipient: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
  errorTitle?: string;
}

const MEDIA_TYPES: Record<string, MediaType> = {
  image: MediaType.IMAGE,
  video: MediaType.VIDEO,
  audio: MediaType.AUDIO,
  document: MediaType.DOCUMENT,
};

/**
 * Flattens Meta's deeply nested webhook envelope into the handful of fields
 * the bot actually reacts to.
 */
export function parseWebhook(body: any): {
  messages: InboundMessage[];
  statuses: InboundStatus[];
} {
  const messages: InboundMessage[] = [];
  const statuses: InboundStatus[] = [];

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      const phoneNumberId: string = value.metadata?.phone_number_id ?? '';
      const contacts: any[] = value.contacts ?? [];

      for (const message of value.messages ?? []) {
        const profileName = contacts.find((c) => c.wa_id === message.from)?.profile?.name;
        const base = {
          waMessageId: message.id,
          phoneNumberId,
          from: message.from,
          profileName,
          timestamp: new Date(Number.parseInt(message.timestamp, 10) * 1000),
          raw: message,
        };

        switch (message.type) {
          case 'text':
            messages.push({ ...base, kind: 'text', text: message.text?.body });
            break;
          case 'image':
          case 'video':
          case 'audio':
          case 'document':
            messages.push({
              ...base,
              kind: message.type,
              mediaId: message[message.type]?.id,
              mimeType: message[message.type]?.mime_type,
              mediaType: MEDIA_TYPES[message.type],
              caption: message[message.type]?.caption,
            });
            break;
          case 'location':
            messages.push({
              ...base,
              kind: 'location',
              latitude: message.location?.latitude,
              longitude: message.location?.longitude,
              locationName: message.location?.name,
              locationAddress: message.location?.address,
            });
            break;
          case 'interactive': {
            const interactive = message.interactive;
            if (interactive?.type === 'button_reply') {
              messages.push({
                ...base,
                kind: 'button_reply',
                replyId: interactive.button_reply?.id,
                replyTitle: interactive.button_reply?.title,
                text: interactive.button_reply?.title,
              });
            } else if (interactive?.type === 'list_reply') {
              messages.push({
                ...base,
                kind: 'list_reply',
                replyId: interactive.list_reply?.id,
                replyTitle: interactive.list_reply?.title,
                text: interactive.list_reply?.title,
              });
            } else {
              messages.push({ ...base, kind: 'unsupported' });
            }
            break;
          }
          // Legacy template quick-replies arrive as type "button".
          case 'button':
            messages.push({
              ...base,
              kind: 'button_reply',
              replyId: message.button?.payload,
              replyTitle: message.button?.text,
              text: message.button?.text,
            });
            break;
          default:
            messages.push({ ...base, kind: 'unsupported' });
        }
      }

      for (const status of value.statuses ?? []) {
        statuses.push({
          waMessageId: status.id,
          phoneNumberId,
          recipient: status.recipient_id,
          status: status.status,
          timestamp: new Date(Number.parseInt(status.timestamp, 10) * 1000),
          errorTitle: status.errors?.[0]?.title,
        });
      }
    }
  }

  return { messages, statuses };
}
