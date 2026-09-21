import { isWithinServiceWindow } from './time.util';
import { propertyTeaser, templateParam } from '../../modules/whatsapp/messages';
import { DealType, PropertyType } from '@prisma/client';

const NOW = new Date('2026-09-21T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

/**
 * Meta accepts a free-form message only within 24 hours of the customer's last
 * one. Get this wrong and the headline feature - "أرسلها لعملاء آخر شهر" -
 * fails for the entire audience it was built for, because a customer who
 * searched three weeks ago is by definition outside the window.
 */
describe('Meta 24-hour service window', () => {
  it('allows a free-form send to a customer who just wrote', () => {
    expect(isWithinServiceWindow(hoursAgo(0.5), NOW)).toBe(true);
  });

  it('allows it late in the window', () => {
    expect(isWithinServiceWindow(hoursAgo(20), NOW)).toBe(true);
  });

  it('refuses it past 24 hours', () => {
    expect(isWithinServiceWindow(hoursAgo(25), NOW)).toBe(false);
  });

  it('refuses it for the month-old searcher the broadcast targets', () => {
    expect(isWithinServiceWindow(hoursAgo(24 * 21), NOW)).toBe(false);
  });

  /**
   * A recipient waits in the queue between the check and the send. Without the
   * margin, a lead at 23h59m passes the check and is then rejected by Meta -
   * the one failure mode a template exists to avoid.
   */
  it('keeps a margin so a lead at the boundary is sent a template instead', () => {
    expect(isWithinServiceWindow(hoursAgo(23.9), NOW)).toBe(false);
    expect(isWithinServiceWindow(hoursAgo(23.4), NOW)).toBe(true);
  });

  it('treats a lead who has never written as outside the window', () => {
    expect(isWithinServiceWindow(null, NOW)).toBe(false);
    expect(isWithinServiceWindow(undefined, NOW)).toBe(false);
  });
});

/** Meta rejects the whole send if a parameter carries a newline or a tab. */
describe('template parameters', () => {
  it('flattens a value the owner typed across two lines', () => {
    expect(templateParam('حي النرجس\nشمال الرياض')).toBe('حي النرجس شمال الرياض');
  });

  it('collapses runs of spaces and tabs', () => {
    expect(templateParam('فيلا     \t  للبيع')).toBe('فيلا للبيع');
  });

  it('never yields an empty parameter', () => {
    expect(templateParam('   ')).toBe('-');
  });

  it('builds a single-line teaser from a property', () => {
    const teaser = propertyTeaser({
      dealType: DealType.SALE,
      propertyType: PropertyType.VILLA,
      district: 'النرجس',
      city: 'الرياض',
      areaSqm: 400,
      bedrooms: 5,
    });
    expect(teaser).toContain('النرجس');
    expect(teaser).toContain('400 م²');
    expect(teaser).not.toMatch(/[\n\t]/);
  });

  it('falls back to the city when no district was given', () => {
    const teaser = propertyTeaser({
      dealType: DealType.RENT,
      propertyType: PropertyType.APARTMENT,
      district: null,
      city: 'جدة',
      areaSqm: null,
      bedrooms: null,
    });
    expect(teaser).toContain('جدة');
  });
});
