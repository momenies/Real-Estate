import { parseOwnerCommand, parseRefCode, parseWindow } from './command-parser';
import { normalizeArabic } from './arabic.util';

describe('parseOwnerCommand - the office owner types the way he talks', () => {
  it('reads a full broadcast order', () => {
    expect(parseOwnerCommand('أرسل العرض FLB-002 لعملاء آخر شهر')).toEqual({
      kind: 'BROADCAST',
      refCode: 'FLB-002',
      windowDays: 30,
      windowLabel: 'آخر شهر',
    });
  });

  it.each([
    ['ارسل FLB-2 لعملاء اخر اسبوع', 'FLB-002', 7],
    ['ابعث العرض she-101 للعملاء آخر يوم', 'SHE-101', 1],
    ['وزع العرض ARB-102 على العملاء آخر ٣ أشهر', 'ARB-102', 90],
    ['أرسله لعملاء آخر 15 يوم', null, 15],
    ['ارسل اخر عرض لكل العملاء', null, 3650],
  ])('understands %s', (text, refCode, windowDays) => {
    expect(parseOwnerCommand(text)).toMatchObject({ kind: 'BROADCAST', refCode, windowDays });
  });

  it('defaults to the last month when no window is stated', () => {
    expect(parseOwnerCommand('أرسل العرض FLB-002 للعملاء')).toMatchObject({
      windowDays: 30,
      windowLabel: 'آخر شهر',
    });
  });

  it('honours an unusual span as typed instead of snapping it', () => {
    // Snapping «آخر ١٥ يوم» to a preset would silently reach a different set of
    // people than the owner asked for.
    expect(parseOwnerCommand('ارسل العرض FLB-002 لعملاء اخر ١٥ يوم')).toMatchObject({
      windowDays: 15,
      windowLabel: 'آخر 15 يوم',
    });
  });

  /**
   * The important negative case: `handleCommand` runs before the draft logic, so
   * anything wrongly read as a command destroys the listing the owner just typed.
   */
  it.each([
    'فيلا للبيع في حي النرجس السعر 1,850,000 ريال',
    'شقة للايجار الملقا 45 الف، أرسل لي الصور بعدين',
    'العميل يبي شقة وأرسل له العنوان',
    'السعر 900 الف',
    'تمام',
  ])('does not mistake %s for a command', (text) => {
    expect(parseOwnerCommand(text)).toBeNull();
  });

  it('reads the short commands', () => {
    expect(parseOwnerCommand('عروضي')).toEqual({ kind: 'LIST_PROPERTIES' });
    expect(parseOwnerCommand('عملائي')).toEqual({ kind: 'LIST_LEADS' });
    expect(parseOwnerCommand('اشتراكي')).toEqual({ kind: 'SUBSCRIPTION' });
    expect(parseOwnerCommand('مساعدة')).toEqual({ kind: 'HELP' });
    expect(parseOwnerCommand('إلغاء الإرسال')).toEqual({ kind: 'CANCEL_BROADCAST' });
  });

  it('normalises ref codes to the stored form', () => {
    expect(parseRefCode('flb-2')).toBe('FLB-002');
    expect(parseRefCode('العرض SHE 101')).toBe('SHE-101');
    expect(parseRefCode('ما فيه رقم عرض')).toBeNull();
  });

  it('reads windows out of loose phrasing', () => {
    const w = (text: string) => parseWindow(normalizeArabic(text));
    expect(w('آخر أسبوعين')).toMatchObject({ days: 14 });
    expect(w('اخر شهرين')).toMatchObject({ days: 60 });
    expect(w('خلال السنة')).toMatchObject({ days: 365 });
    expect(w('بدون تحديد')).toBeNull();
  });
});
