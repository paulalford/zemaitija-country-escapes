import 'server-only';
import type { Pool } from 'pg';
import { recoveryPolicy } from './payment-recovery';

export const SESSION_REPLAY_MILLISECONDS = 86_400_000;
export const SESSION_CALL_MILLISECONDS = 10_000;
export function commandRetrySeconds(attempts: number, random = Math.random): number {
  return recoveryPolicy('UNCERTAIN', Math.max(0, attempts - 1), random).delay!;
}
/** Recheck chronology and lease on the database clock immediately before POST.
 * The full bounded provider window must fit inside both fences. No new request/key. */
export async function sessionSubmissionGate(pool: Pool, commandId: string, worker: string,
  generation: bigint): Promise<'SUBMIT' | 'PENDING' | 'QUARANTINED'> {
  const safe = await pool.query<{ safe: boolean }>(`SELECT (
    state='SUBMITTED' AND lease_owner=$2 AND lease_generation=$3
    AND lease_expires_at>clock_timestamp()+($4*interval '1 millisecond')
    AND first_submitted_at IS NOT NULL
    AND first_submitted_at>clock_timestamp()-interval '24 hours'+($4*interval '1 millisecond')
  ) safe FROM provider_commands WHERE id=$1`,
  [commandId, worker, generation.toString(), SESSION_CALL_MILLISECONDS + 1000]);
  if (safe.rows[0]?.safe === true) return 'SUBMIT';
  const changed = await pool.query(`UPDATE provider_commands SET state='QUARANTINED',
    lease_owner=NULL,lease_expires_at=NULL,last_error_code='IDEMPOTENCY_AGE_UNSAFE'
    WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND state='SUBMITTED'
      AND lease_expires_at>clock_timestamp()
      AND (first_submitted_at IS NULL OR
        first_submitted_at<=clock_timestamp()-interval '24 hours'+($4*interval '1 millisecond'))`,
  [commandId, worker, generation.toString(), SESSION_CALL_MILLISECONDS + 1000]);
  return changed.rowCount === 1 ? 'QUARANTINED' : 'PENDING';
}
