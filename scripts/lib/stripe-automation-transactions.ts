import type { SqlSession } from './stripe-automation-connection';
/** Transport errors cannot establish whether COMMIT reached PostgreSQL. No retry,
 * rollback claim or cleanup is authorized by an uncertain acknowledgement. */
export async function commitAcknowledgement(session:Pick<SqlSession,'query'>):Promise<'ACKNOWLEDGED'|'UNCERTAIN'> {
  try {await session.query('COMMIT');return 'ACKNOWLEDGED';}catch {return 'UNCERTAIN';}
}
