import type { Pool } from 'pg';

export type AvailabilityInput = { unitId: string; arrivalDate: string; departureDate: string; guestCount: number };
export type AvailabilityResult =
  | { available: true; reason: 'AVAILABLE' }
  | { available: false; reason: 'INVALID_INPUT' | 'UNIT_UNAVAILABLE' | 'CAPACITY_EXCEEDED' | 'INVENTORY_CONFLICT' };

function calendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validStay(input: AvailabilityInput): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.unitId)
    && calendarDate(input.arrivalDate) && calendarDate(input.departureDate)
    && input.arrivalDate < input.departureDate
    && Number.isSafeInteger(input.guestCount) && input.guestCount > 0;
}

/** Advisory read only. A later claim INSERT and COMMIT determine ownership. Database errors propagate. */
export async function checkAvailability(pool: Pool, input: AvailabilityInput): Promise<AvailabilityResult> {
  if (!validStay(input)) return { available: false, reason: 'INVALID_INPUT' };
  const result = await pool.query<{ enabled: boolean; capacity: number; occupied: boolean }>(`
    SELECT u.enabled, u.capacity, EXISTS (
      SELECT 1 FROM inventory_claims c
      WHERE c.unit_id = u.id AND c.released_at IS NULL
        AND c.stay && daterange($2::date, $3::date, '[)')
    ) AS occupied
    FROM accommodation_units u WHERE u.id = $1`, [input.unitId, input.arrivalDate, input.departureDate]);
  const unit = result.rows[0];
  if (!unit || !unit.enabled) return { available: false, reason: 'UNIT_UNAVAILABLE' };
  if (input.guestCount > unit.capacity) return { available: false, reason: 'CAPACITY_EXCEEDED' };
  if (unit.occupied) return { available: false, reason: 'INVENTORY_CONFLICT' };
  return { available: true, reason: 'AVAILABLE' };
}

export function isInventoryConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01';
}
