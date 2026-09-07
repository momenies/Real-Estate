const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** ٤٥٠ -> 450, so every downstream regex only has to know Western digits. */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (char) => {
    const arabic = ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) return String(arabic);
    return String(EXTENDED_ARABIC_INDIC.indexOf(char));
  });
}

/**
 * Fold the spelling variants people actually type on a phone keyboard, so
 * "الملقا"/"الملقى" and "فيلا"/"فلة" match the same rule.
 */
export function normalizeArabic(input: string): string {
  return toWesternDigits(input)
    .replace(/[ـ]/g, '') // tatweel
    .replace(/[ً-ْٰ]/g, '') // harakat
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1,500,000" -> 1500000, "1.5" -> 1.5, "1,5" -> 1.5 */
export function parseNumericToken(token: string): number | null {
  const cleaned = token.trim();
  if (!cleaned) return null;
  const thousandGrouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned);
  const normalized = thousandGrouped ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}
