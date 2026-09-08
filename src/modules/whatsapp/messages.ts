import { DealType, PropertyType } from '@prisma/client';

/**
 * Every word the office owner and the customer ever see.
 *
 * Kept in one file on purpose: the entire product surface for a traditional
 * office is this text plus a few buttons, so it deserves to be reviewable in
 * one place.
 */

export const DEAL_LABELS: Record<DealType, string> = {
  SALE: 'للبيع',
  RENT: 'للإيجار',
  INVESTMENT: 'استثمار',
  UNKNOWN: 'غير محدد',
};

export const TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: 'شقة',
  VILLA: 'فيلا',
  LAND: 'أرض',
  BUILDING: 'عمارة',
  SHOP: 'محل',
  OFFICE: 'مكتب',
  FARM: 'مزرعة',
  CHALET: 'شاليه',
  REST_HOUSE: 'استراحة',
  OTHER: 'عقار',
};

export const formatSar = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'غير محدد' : `${value.toLocaleString('en-US')} ريال`;

export const OWNER = {
  welcome: (officeName: string) =>
    `أهلاً بك في ${officeName} 👋\n\n` +
    `أرسل لي العقار مباشرة هنا:\n` +
    `📸 الصور\n🎥 مقطع فيديو قصير\n✍️ السعر والحي\n📍 موقع العقار (الدبوس)\n\n` +
    `أنا أرتّبها وأجهّز الإعلان، وأنت ما عليك شيء.`,

  mediaReceived: (count: number) => `📥 استلمت ${count} ملف. أكمل الإرسال وأنا أرتّبها لك.`,

  askPrice: 'كم السعر المطلوب؟ اكتبه بالأرقام، مثال: 850 الف أو 1.2 مليون',
  askDistrict: 'في أي حي يقع العقار؟',
  askDealType: 'العقار للبيع أو للإيجار؟',
  askPropertyType: 'وش نوع العقار؟',

  summary: (params: {
    refCode: string;
    dealType: DealType;
    propertyType: PropertyType;
    priceSar: number | null;
    district: string | null;
    city: string | null;
    areaSqm: number | null;
    bedrooms: number | null;
    mediaCount: number;
    hasLocation: boolean;
  }) => {
    const lines = [
      `📋 *مراجعة العرض* (${params.refCode})`,
      '',
      `• النوع: ${TYPE_LABELS[params.propertyType]} ${DEAL_LABELS[params.dealType]}`,
      `• السعر: ${formatSar(params.priceSar)}`,
      `• الحي: ${params.district ?? 'غير محدد'}${params.city ? ` - ${params.city}` : ''}`,
    ];
    if (params.areaSqm) lines.push(`• المساحة: ${params.areaSqm} م²`);
    if (params.bedrooms) lines.push(`• الغرف: ${params.bedrooms}`);
    lines.push(`• المرفقات: ${params.mediaCount} ملف`);
    lines.push(`• الموقع: ${params.hasLocation ? 'تم استلامه ✅' : 'لم يُرسل'}`);
    lines.push('', 'أعتمد النشر؟');
    return lines.join('\n');
  },

  published: (refCode: string) => `✅ تم نشر العرض ${refCode} وأصبح جاهزاً.\n\nتبي أرسله للعملاء؟`,

  canceled: '❌ تم إلغاء العرض ولم يُنشر.',

  editHint: 'أرسل التعديل كنص عادي وأنا أحدّثه.\nمثال: «السعر 950 الف» أو «الحي النرجس».',

  broadcastQueued: (count: number, windowLabel: string) =>
    `📤 جاري الإرسال إلى ${count} عميل (${windowLabel}).\n` +
    `لن يُرسل العرض لمن استلمه سابقاً، ولن يستلم العميل أكثر من إعلان واحد في اليوم.`,

  broadcastNoAudience: 'ما فيه عملاء مطابقين في هذه الفترة. جرّب فترة أوسع أو انتظر عملاء جدد.',

  broadcastDone: (sent: number, skipped: number, failed: number) =>
    `📊 *تقرير الإرسال*\n• تم الإرسال: ${sent}\n• تم التخطي (مكرر أو تجاوز الحد اليومي): ${skipped}` +
    (failed ? `\n• فشل: ${failed}` : ''),

  trialReminder: (officeName: string, days: number) =>
    `تنبيه ${officeName}: تبقى ${days} يوم على انتهاء الفترة المجانية.\n` +
    `للاستمرار بدون انقطاع تواصل معنا للتجديد.`,

  trialExpired: (officeName: string) =>
    `انتهت الفترة المجانية لـ ${officeName}.\n` +
    `بياناتك وعملاؤك محفوظون كما هم، وبمجرد التجديد يرجع كل شيء يعمل مباشرة.`,

  subscriptionBlocked:
    '⚠️ الاشتراك منتهي، ولا يمكن إضافة عروض جديدة أو الإرسال للعملاء حالياً.\n' +
    'تواصل معنا للتجديد وسيعود كل شيء فوراً.',

  pickProperty: 'اختر العرض اللي تبي ترسله:',

  noProperties: 'ما فيه عروض منشورة بعد. أرسل صور العقار والسعر والحي وأنا أجهّزه لك.',

  propertyNotFound: (refCode: string) =>
    `ما لقيت عرض برقم ${refCode}. أرسل «عروضي» وأنا أعرض لك القائمة.`,

  propertyActions: (refCode: string) => `العرض ${refCode} — لمين ترسله؟`,

  broadcastCanceled: (pending: number) =>
    `🛑 تم إيقاف الإرسال. لم تُرسل ${pending} رسالة كانت في الانتظار.`,

  noActiveBroadcast: 'ما فيه إرسال جارٍ حالياً.',

  help:
    'الأوامر السريعة:\n' +
    '• أرسل صور/فيديو + السعر والحي لإضافة عرض\n' +
    '• «عروضي» لاختيار عرض وإرساله للعملاء\n' +
    '• «أرسل العرض FLB-002 لعملاء آخر شهر»\n' +
    '• «إلغاء الإرسال» لإيقاف إرسال جارٍ\n' +
    '• «عملائي» لعدد العملاء\n' +
    '• «اشتراكي» لحالة الاشتراك',
};

export const LEAD = {
  greeting: (officeName: string) => `أهلاً بك في ${officeName} 🌟\nعشان أساعدك بسرعة، وش تبي؟`,

  askPropertyType: 'وش نوع العقار اللي تدور عليه؟',
  askDistrict: 'في أي حي تفضّل؟ اكتب اسم الحي، أو اختر «كل الأحياء».',
  askBudget: 'وش ميزانيتك تقريباً؟',

  saved: 'تم ✅ سجّلنا طلبك، وبنرسل لك أول ما يتوفر عرض مناسب.',

  latestIntro: 'هذي آخر العروض المتوفرة عندنا حالياً:',
  noMatches: 'ما عندنا حالياً عرض مطابق، لكن سجّلنا طلبك وبنرسل لك أول ما ينزل شيء مناسب.',

  optedOut: 'تم إيقاف الرسائل ✅ لن تصلك عروض بعد الآن. أرسل «اشتراك» للعودة.',
  optedIn: 'تم تفعيل العروض من جديد ✅',

  footerOptOut: 'للإيقاف أرسل: إيقاف',
};

export const propertyCard = (params: {
  refCode: string;
  dealType: DealType;
  propertyType: PropertyType;
  priceSar: number | null;
  district: string | null;
  city: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  features: string[];
  officeName: string;
  officePhone?: string | null;
}): string => {
  const lines = [
    `🏠 *${TYPE_LABELS[params.propertyType]} ${DEAL_LABELS[params.dealType]}*`,
    params.district ? `📍 ${params.district}${params.city ? ` - ${params.city}` : ''}` : null,
    `💰 ${formatSar(params.priceSar)}`,
    params.areaSqm ? `📐 المساحة: ${params.areaSqm} م²` : null,
    params.bedrooms ? `🛏 الغرف: ${params.bedrooms}` : null,
    params.bathrooms ? `🚿 دورات المياه: ${params.bathrooms}` : null,
    params.features.length ? `✨ ${params.features.join(' • ')}` : null,
    '',
    `🔖 رقم العرض: ${params.refCode}`,
    `🏢 ${params.officeName}`,
    params.officePhone ? `📞 ${params.officePhone}` : null,
  ];
  return lines.filter((line) => line !== null).join('\n');
};
