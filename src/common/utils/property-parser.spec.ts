import { DealType, PropertyType } from '@prisma/client';
import { parseProperty } from './property-parser';

describe('parseProperty - the office owner types, the bot understands', () => {
  it('reads a full sale listing', () => {
    const parsed = parseProperty(
      'فيلا للبيع في حي النرجس بالرياض السعر 1,500,000 ريال مساحة 400 م 5 غرف مسبح ومصعد',
    );
    expect(parsed.dealType).toBe(DealType.SALE);
    expect(parsed.propertyType).toBe(PropertyType.VILLA);
    expect(parsed.priceSar).toBe(1_500_000);
    expect(parsed.district).toBe('النرجس');
    expect(parsed.city).toBe('الرياض');
    expect(parsed.areaSqm).toBe(400);
    expect(parsed.bedrooms).toBe(5);
    expect(parsed.features).toEqual(expect.arrayContaining(['مسبح', 'مصعد']));
    expect(parsed.missing).toHaveLength(0);
  });

  it('expands thousands shorthand on a rental', () => {
    const parsed = parseProperty('شقة للايجار حي الملقا 45 الف 3 غرف');
    expect(parsed.dealType).toBe(DealType.RENT);
    expect(parsed.propertyType).toBe(PropertyType.APARTMENT);
    expect(parsed.priceSar).toBe(45_000);
    expect(parsed.district).toBe('الملقا');
    expect(parsed.bedrooms).toBe(3);
  });

  it('handles Arabic-Indic digits', () => {
    const parsed = parseProperty('أرض للبيع مخطط ٢٣ مساحة ٦٠٠ متر السعر ٩٠٠ الف');
    expect(parsed.propertyType).toBe(PropertyType.LAND);
    expect(parsed.areaSqm).toBe(600);
    expect(parsed.priceSar).toBe(900_000);
  });

  it('reads millions written as a decimal', () => {
    const parsed = parseProperty('دور للبيع حي قرطبة مساحة 300 م بسعر 1.5 مليون');
    expect(parsed.priceSar).toBe(1_500_000);
    expect(parsed.areaSqm).toBe(300);
  });

  it('never mistakes an area or a room count for a price', () => {
    const parsed = parseProperty('شقة للايجار حي الياسمين 4 غرف مساحة 180 م');
    expect(parsed.priceSar).toBeNull();
    expect(parsed.missing).toContain('price');
  });

  it('stops the district at the city name', () => {
    const parsed = parseProperty('عمارة للاستثمار في حي العزيزية جدة 4 أدوار');
    expect(parsed.district).toBe('العزيزيه');
    expect(parsed.city).toBe('جده');
    expect(parsed.propertyType).toBe(PropertyType.BUILDING);
    expect(parsed.floors).toBe(4);
  });
});
