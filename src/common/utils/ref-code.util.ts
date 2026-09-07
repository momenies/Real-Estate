import { DealType, PropertyType } from '@prisma/client';

const TYPE_LETTER: Record<PropertyType, string> = {
  APARTMENT: 'SH',
  VILLA: 'FL',
  LAND: 'AR',
  BUILDING: 'AM',
  SHOP: 'MH',
  OFFICE: 'MK',
  FARM: 'MZ',
  CHALET: 'SL',
  REST_HOUSE: 'IS',
  OTHER: 'AQ',
};

/**
 * A short code the owner can say out loud on the phone ("عرض FL-482").
 * Unique per office, so two offices may both have FL-482 without colliding.
 */
export function buildRefCode(
  propertyType: PropertyType,
  dealType: DealType,
  sequence: number,
): string {
  const suffix = dealType === DealType.RENT ? 'E' : 'B';
  return `${TYPE_LETTER[propertyType] ?? 'AQ'}${suffix}-${String(sequence).padStart(3, '0')}`;
}
