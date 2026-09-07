import { normalizeArabic } from './arabic.util';

/**
 * The office owner's typed commands.
 *
 * He types the way he talks - «أرسل العرض FLB-002 لعملاء آخر شهر» - so this is
 * deliberately forgiving about wording and strict about *where* the verb sits.
 * Anchoring the send verb to the start of the message is what keeps a property
 * description that happens to contain «أرسل» from being hijacked as a command
 * and losing the owner's text.
 */
export type OwnerCommand =
  | { kind: 'BROADCAST'; refCode: string | null; windowDays: number; windowLabel: string }
  | { kind: 'CANCEL_BROADCAST' }
  | { kind: 'LIST_PROPERTIES' }
  | { kind: 'LIST_LEADS' }
  | { kind: 'SUBSCRIPTION' }
  | { kind: 'HELP' };

/**
 * Send verbs, only honoured at the very start of the message.
 * Bounded with a negative lookahead, not `\b`: JS word boundaries are
 * ASCII-only and never match between an Arabic letter and a space.
 */
const SEND_VERB = /^(?:يا\s+)?(?:ارسل|ابعث|وزع|انشر|رسل)(?:ه|ها|هم)?(?![ء-ي])/;

/** Something that names an audience - required, so a bare verb is not a command. */
const AUDIENCE = /(عملاء|العملاء|زباين|الزباين|زبائن|الزبائن|المهتمين|الناس)/;

/** Office ref codes look like FL-001 / SHE-102 / AQB-1. */
const REF_CODE = /([A-Z]{2,4})\s*-?\s*(\d{1,4})(?!\d)/i;

const LATEST_PROPERTY = /(اخر عرض|احدث عرض|العرض الاخير|اخر عقار|العقار الاخير)/;

interface Window {
  days: number;
  label: string;
}

/**
 * Reads the time window the owner means. Arbitrary spans are honoured as typed
 * («آخر ١٥ يوم» stays 15) rather than snapped to a preset - snapping would
 * quietly send to a different set of people than he asked for.
 */
export function parseWindow(normalized: string): Window | null {
  const everyone = /(كل العملاء|جميع العملاء|كل الزباين|الكل)/.exec(normalized);
  if (everyone) return { days: 3650, label: 'كل العملاء' };

  const explicitDays = /(?:اخر\s*)?(\d{1,3})\s*(?:يوم|ايام)/.exec(normalized);
  if (explicitDays) {
    const days = Number.parseInt(explicitDays[1], 10);
    if (days >= 1 && days <= 3650) return { days, label: `آخر ${days} يوم` };
  }

  const explicitMonths = /(?:اخر\s*)?(\d{1,2})\s*(?:شهور|اشهر|شهر)/.exec(normalized);
  if (explicitMonths) {
    const months = Number.parseInt(explicitMonths[1], 10);
    if (months >= 1 && months <= 60) {
      return { days: months * 30, label: `آخر ${months} شهر` };
    }
  }

  if (/(ثلاثه اشهر|ثلاث شهور|ربع سنه)/.test(normalized)) return { days: 90, label: 'آخر ٣ أشهر' };
  if (/(شهرين)/.test(normalized)) return { days: 60, label: 'آخر شهرين' };
  if (/(اسبوعين)/.test(normalized)) return { days: 14, label: 'آخر أسبوعين' };
  if (/(سنه|السنه)/.test(normalized)) return { days: 365, label: 'آخر سنة' };
  if (/(اسبوع|الاسبوع)/.test(normalized)) return { days: 7, label: 'آخر أسبوع' };
  if (/(شهر|الشهر)/.test(normalized)) return { days: 30, label: 'آخر شهر' };
  if (/(اليوم|اخر يوم|24 ساعه|امس|البارحه)/.test(normalized)) {
    return { days: 1, label: 'آخر يوم' };
  }

  return null;
}

export function parseRefCode(text: string): string | null {
  const match = REF_CODE.exec(text);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2].padStart(3, '0')}`;
}

export function parseOwnerCommand(rawText: string): OwnerCommand | null {
  const text = (rawText ?? '').trim();
  if (!text) return null;
  const normalized = normalizeArabic(text);

  if (
    /^(الغاء الارسال|ايقاف الارسال|الغاء البث|وقف الارسال|لا ترسل|توقف عن الارسال)$/.test(
      normalized,
    )
  ) {
    return { kind: 'CANCEL_BROADCAST' };
  }
  if (/^(عروضي|العروض|عقاراتي|قايمه العروض|قائمه العروض)$/.test(normalized)) {
    return { kind: 'LIST_PROPERTIES' };
  }
  // Matched against the *normalised* spelling: «عملائي» folds to «عملايي».
  if (/^(عملايي|العملاء|زبايني|الزباين)$/.test(normalized)) {
    return { kind: 'LIST_LEADS' };
  }
  if (/^(اشتراكي|الاشتراك|حسابي)$/.test(normalized)) {
    return { kind: 'SUBSCRIPTION' };
  }
  if (/^(مساعده|المساعده|help|الاوامر)$/i.test(normalized)) {
    return { kind: 'HELP' };
  }

  // A broadcast needs the verb up front AND a named audience. Both together are
  // what make it unmistakably a command rather than part of a listing.
  if (SEND_VERB.test(normalized) && AUDIENCE.test(normalized)) {
    const window = parseWindow(normalized) ?? { days: 30, label: 'آخر شهر' };
    const refCode = LATEST_PROPERTY.test(normalized) ? null : parseRefCode(text);
    return { kind: 'BROADCAST', refCode, windowDays: window.days, windowLabel: window.label };
  }

  return null;
}
