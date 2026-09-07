/**
 * WhatsApp identifies people by `wa_id`: E.164 digits with no '+'.
 * Saudi numbers arrive in half a dozen shapes ("0501234567", "+966 50 123 4567",
 * "٠٥٠١٢٣٤٥٦٧"), and all of them must resolve to one lead.
 */
import { toWesternDigits } from './arabic.util';

export function normalizeWaId(input: string, defaultCountryCode = '966'): string {
  let digits = toWesternDigits(input ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Local form: 05xxxxxxxx -> 9665xxxxxxxx
  if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
  // Bare mobile without the leading zero: 5xxxxxxxx
  if (digits.length === 9 && digits.startsWith('5')) digits = defaultCountryCode + digits;
  return digits;
}

export function toDisplayPhone(waId: string): string {
  const digits = normalizeWaId(waId);
  return digits ? `+${digits}` : '';
}
