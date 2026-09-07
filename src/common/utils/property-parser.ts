import { DealType, PropertyType } from '@prisma/client';
import { normalizeArabic, parseNumericToken } from './arabic.util';

export interface ParsedProperty {
  dealType: DealType;
  propertyType: PropertyType;
  priceSar: number | null;
  district: string | null;
  city: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  ageYears: number | null;
  features: string[];
  /** Fields the parser could not fill - the bot asks about these, nothing else. */
  missing: string[];
}

const DEAL_PATTERNS: Array<[RegExp, DealType]> = [
  [/(للايجار|الايجار|ايجار|يوجد للايجار|للتاجير)/, DealType.RENT],
  [/(للبيع|البيع|بيع|للتمليك|تمليك|مطلوب بيع)/, DealType.SALE],
  [/(استثمار|استثماري|دخل)/, DealType.INVESTMENT],
];

const TYPE_PATTERNS: Array<[RegExp, PropertyType]> = [
  [/(شقه|شقق|دوبلكس)/, PropertyType.APARTMENT],
  [/(فيلا|فلل|فله|دور علوي|دور ارضي|بيت شعبي)/, PropertyType.VILLA],
  [/(ارض|اراضي|قطعه ارض|مخطط)/, PropertyType.LAND],
  [/(عماره|عمارات|مبني|برج)/, PropertyType.BUILDING],
  [/(محل|محلات|معرض)/, PropertyType.SHOP],
  [/(مكتب|مكاتب|مقر اداري)/, PropertyType.OFFICE],
  [/(مزرعه|مزارع)/, PropertyType.FARM],
  [/(شاليه|شاليهات)/, PropertyType.CHALET],
  [/(استراحه|استراحات)/, PropertyType.REST_HOUSE],
];

const CITIES = [
  'الرياض',
  'جده',
  'مكه',
  'المدينه',
  'الدمام',
  'الخبر',
  'الظهران',
  'الطايف',
  'بريده',
  'عنيزه',
  'تبوك',
  'ابها',
  'خميس مشيط',
  'الاحساء',
  'الهفوف',
  'حايل',
  'نجران',
  'جازان',
  'الجبيل',
  'ينبع',
  'الخرج',
  'القطيف',
  'عرعر',
  'سكاكا',
  'الباحه',
  'رابغ',
  'الزلفي',
  'المجمعه',
  'وادي الدواسر',
];

const FEATURE_PATTERNS: Array<[RegExp, string]> = [
  [/مسبح/, 'مسبح'],
  [/مصعد/, 'مصعد'],
  [/(مؤثثه|مؤثث|مفروشه|مفروش)/, 'مفروشة'],
  [/(مكيفات|مكيف|سبليت)/, 'مكيفات'],
  [/(حديقه|حوش)/, 'حديقة'],
  [/ملحق/, 'ملحق'],
  [/قبو/, 'قبو'],
  [/(مدخل سيارات|مدخل سياره|كراج|موقف)/, 'موقف سيارات'],
  [/(مدخلين|مدخلان)/, 'مدخلين'],
  [/(شقتين|شقق داخليه)/, 'شقق داخلية'],
  [/(جديده|جديد|لم تسكن)/, 'جديد'],
  [/(زاويه|زاوي)/, 'زاوية'],
  [/(شارعين|علي شارعين)/, 'على شارعين'],
  [/(صك الكتروني|صك)/, 'صك إلكتروني'],
];

/** Units that mean a number is NOT a price - checked before price extraction. */
// NOTE: JS \b is ASCII-only and never fires next to an Arabic letter, so unit
// suffixes are bounded with a negative lookahead instead.
const MEASUREMENT_PATTERNS = [
  /(\d+(?:[.,]\d+)?)\s*(?:م2|م٢|متر مربع|متر|م)(?![ء-ي])/g,
  /(?:مساحه|المساحه)\s*:?\s*(\d+(?:[.,]\d+)?)/g,
  /(\d+)\s*(?:غرف نوم|غرف|غرفه)/g,
  /(\d+)\s*(?:دورات مياه|دوره مياه|حمامات|حمام)/g,
  /(\d+)\s*(?:ادوار|دور|طوابق|طابق)/g,
  /(\d+)\s*(?:سنوات|سنه|سنين)/g,
  /(?:شارع)\s*(\d+)/g,
];

const firstMatch = (text: string, patterns: RegExp[]): number | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseNumericToken(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
};

/**
 * Price is the field most likely to be misread, because an area ("400 م")
 * and a room count ("5 غرف") are numbers too. So measurements are blanked out
 * first, and only what survives is considered a price.
 */
export function parsePrice(normalized: string): number | null {
  let text = normalized;
  for (const pattern of MEASUREMENT_PATTERNS) {
    text = text.replace(new RegExp(pattern.source, 'g'), ' ');
  }

  const millions = text.match(/(\d+(?:[.,]\d+)?)\s*(?:مليون|ملايين|م\.ر)/);
  if (millions?.[1]) {
    const value = parseNumericToken(millions[1]);
    if (value !== null) return Math.round(value * 1_000_000);
  }

  const thousands = text.match(/(\d+(?:[.,]\d+)?)\s*(?:الف|الاف|ك)(?![ء-ي])/);
  if (thousands?.[1]) {
    const value = parseNumericToken(thousands[1]);
    if (value !== null) return Math.round(value * 1_000);
  }

  const labelled = text.match(/(?:السعر|سعر|بسعر|المطلوب|مطلوب|علي|ب)\s*:?\s*([\d,]+(?:\.\d+)?)/);
  if (labelled?.[1]) {
    const value = parseNumericToken(labelled[1]);
    if (value !== null && value >= 1_000) return Math.round(value);
  }

  const currency = text.match(/([\d,]+(?:\.\d+)?)\s*(?:ريال|ر\.س|sar)/i);
  if (currency?.[1]) {
    const value = parseNumericToken(currency[1]);
    if (value !== null) return Math.round(value);
  }

  // A bare, large, well-formed number is almost always the asking price.
  const bare = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{5,9})\b/);
  if (bare?.[1]) {
    const value = parseNumericToken(bare[1]);
    if (value !== null && value >= 1_000) return Math.round(value);
  }

  return null;
}

const DISTRICT_STOP_WORDS = new Set([
  'في',
  'علي',
  'و',
  'ثم',
  'قريب',
  'بجوار',
  'خلف',
  'امام',
  'شمال',
  'جنوب',
  'شرق',
  'غرب',
  'مقابل',
  'السعر',
  'سعر',
  'بسعر',
  'مساحه',
  'المساحه',
  'غرف',
  'غرفه',
  'دور',
  'ادوار',
  'ريال',
  'مطلوب',
  'شارع',
  'جوال',
  'للبيع',
  'للايجار',
  'ايجار',
  'بيع',
  'تواصل',
  'واتساب',
]);

/**
 * "حي النرجس بالرياض" must yield "النرجس", not "النرجس بالرياض" - so a second
 * word is only kept when it is genuinely part of the name ("الملك فهد") and
 * not a city, a preposition, or the start of the next clause.
 */
export function parseDistrict(normalized: string): string | null {
  const explicit = normalized.match(/(?:حي|بحي|في حي)\s+((?:ال)?[ء-ي]+(?:\s+(?:ال)?[ء-ي]+)?)/);
  if (!explicit?.[1]) return null;

  const kept: string[] = [];
  for (const word of explicit[1].split(' ')) {
    const bare = word.replace(/^(?:بال|وال|ب|و|ال)/, '');
    if (DISTRICT_STOP_WORDS.has(word) || DISTRICT_STOP_WORDS.has(bare)) break;
    if (CITIES.includes(word) || CITIES.includes(bare) || CITIES.includes(`ال${bare}`)) break;
    kept.push(word);
  }

  return kept.length ? kept.join(' ') : null;
}

export function parseCity(normalized: string): string | null {
  return CITIES.find((city) => normalized.includes(city)) ?? null;
}

export function parseProperty(rawText: string): ParsedProperty {
  const normalized = normalizeArabic(rawText ?? '');

  const dealType =
    DEAL_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1] ?? DealType.UNKNOWN;
  const propertyType =
    TYPE_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1] ?? PropertyType.OTHER;

  const areaSqm = firstMatch(normalized, [
    /(?:مساحه|المساحه)\s*:?\s*(\d+(?:[.,]\d+)?)/,
    /(\d+(?:[.,]\d+)?)\s*(?:م2|م٢|متر مربع|متر|م)(?![ء-ي])/,
  ]);
  const bedrooms = firstMatch(normalized, [/(\d+)\s*(?:غرف نوم|غرف|غرفه)/]);
  const bathrooms = firstMatch(normalized, [/(\d+)\s*(?:دورات مياه|دوره مياه|حمامات|حمام)/]);
  const floors = firstMatch(normalized, [/(\d+)\s*(?:ادوار|دور|طوابق|طابق)/]);
  const ageYears = firstMatch(normalized, [/(?:عمر\D{0,12}?)(\d+)/, /(\d+)\s*(?:سنوات|سنه|سنين)/]);

  const features = FEATURE_PATTERNS.filter(([pattern]) => pattern.test(normalized)).map(
    ([, label]) => label,
  );

  const parsed: ParsedProperty = {
    dealType,
    propertyType,
    priceSar: parsePrice(normalized),
    district: parseDistrict(normalized),
    city: parseCity(normalized),
    areaSqm,
    bedrooms: bedrooms !== null ? Math.round(bedrooms) : null,
    bathrooms: bathrooms !== null ? Math.round(bathrooms) : null,
    floors: floors !== null ? Math.round(floors) : null,
    ageYears: ageYears !== null ? Math.round(ageYears) : null,
    features,
    missing: [],
  };

  parsed.missing = [
    parsed.priceSar === null ? 'price' : null,
    parsed.district === null ? 'district' : null,
    parsed.dealType === DealType.UNKNOWN ? 'dealType' : null,
    parsed.propertyType === PropertyType.OTHER ? 'propertyType' : null,
  ].filter((field): field is string => field !== null);

  return parsed;
}
