import 'server-only';
import type { Pool } from 'pg';
export const publicUnitKeys = ['forest-cottage', 'lakeside-cabin', 'family-cottage'] as const;
export type PublicUnit = { id: string; unit_key: typeof publicUnitKeys[number]; capacity: number };
/** Only the approved fictional catalog is public; capacities and IDs always come from PostgreSQL. */
export async function publicCatalog(pool: Pool): Promise<PublicUnit[]> {
  const result = await pool.query<PublicUnit>(
    'SELECT id,unit_key,capacity FROM accommodation_units WHERE enabled AND unit_key=ANY($1::text[])', [[...publicUnitKeys]]);
  return result.rows.sort((a,b)=>publicUnitKeys.indexOf(a.unit_key)-publicUnitKeys.indexOf(b.unit_key));
}
