import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type PendingHold = { bookingId: string; holdId: string; attemptId: string; commandId: string; holdState: string; attemptState: string; commandState: string; startedAt: Date; firstSubmittedAt: Date | null; leaseGeneration: bigint; claimBlocking: boolean };

async function locked<T>(pool: Pool, holdId: string, work: (client: PoolClient, row: PendingHold) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const owner = await client.query<{ unit_id: string; booking_id: string; guest_id: string }>('SELECT b.unit_id,b.guest_id,b.id booking_id FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id WHERE h.id=$1', [holdId]);
    if (!owner.rows[0]) throw new Error('Unknown hold');
    await client.query('SELECT lock_acceptance_context($1,$2)', [owner.rows[0].unit_id,owner.rows[0].guest_id]);
    await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [owner.rows[0].booking_id]);
    await client.query('SELECT id FROM inventory_holds WHERE id=$1 FOR UPDATE', [holdId]);
    await client.query('SELECT id FROM inventory_claims WHERE hold_id=$1 FOR UPDATE', [holdId]);
    const row = await inspectHold(client, holdId, true);
    if (!row) throw new Error('Incomplete hold');
    const result = await work(client,row);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function inspectHold(client: PoolClient | Pool, holdId: string, lock = false): Promise<PendingHold | null> {
  const result = await client.query<{booking_id:string;hold_id:string;attempt_id:string;command_id:string;hold_state:string;attempt_state:string;command_state:string;started_at:Date;first_submitted_at:Date|null;lease_generation:string;claim_blocking:boolean}>(
    `SELECT b.id booking_id,h.id hold_id,a.id attempt_id,c.id command_id,h.state hold_state,a.state attempt_state,c.state command_state,h.started_at,c.first_submitted_at,c.lease_generation::text,
      EXISTS(SELECT 1 FROM inventory_claims ic WHERE ic.hold_id=h.id AND ic.released_at IS NULL) claim_blocking
     FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id JOIN payment_attempts a ON a.id=h.payment_attempt_id
     JOIN provider_commands c ON c.payment_attempt_id=a.id AND c.kind='SESSION_CREATE' WHERE h.id=$1 ${lock ? 'FOR UPDATE OF a,c' : ''}`, [holdId]);
  const r = result.rows[0];
  return r ? {bookingId:r.booking_id,holdId:r.hold_id,attemptId:r.attempt_id,commandId:r.command_id,holdState:r.hold_state,attemptState:r.attempt_state,commandState:r.command_state,startedAt:r.started_at,firstSubmittedAt:r.first_submitted_at,leaseGeneration:BigInt(r.lease_generation),claimBlocking:r.claim_blocking} : null;
}

/** Reporting only. Age does not authorize release. */
export async function agedCreatingHolds(pool: Pool, ageMinutes = 30): Promise<PendingHold[]> {
  if (!Number.isSafeInteger(ageMinutes) || ageMinutes < 1) throw new RangeError('Invalid age');
  const ids = await pool.query<{id:string}>('SELECT id FROM inventory_holds WHERE state=$1 AND started_at < clock_timestamp() - ($2::int * interval \'1 minute\') ORDER BY started_at LIMIT 100', ['CREATING',ageMinutes]);
  const rows = await Promise.all(ids.rows.map(r => inspectHold(pool,r.id)));
  return rows.filter((r): r is PendingHold => r !== null);
}

/** Records uncertainty and retains the blocking claim. */
export async function markHoldReconciling(pool: Pool, holdId: string): Promise<PendingHold> {
  return locked(pool,holdId,async (client,row) => {
    if (row.holdState === 'CREATING') {
      await client.query("UPDATE inventory_holds SET state='RECONCILING',version=version+1 WHERE id=$1", [holdId]);
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1 AND state='CREATING'", [row.attemptId]);
      await client.query("UPDATE provider_commands SET state='UNKNOWN' WHERE id=$1 AND state='PENDING' AND lease_generation>0", [row.commandId]);
      await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,prior_state,new_state,reason_code,occurred_at)
        VALUES($1,$2,'SERVICE','pending-hold-recovery','hold.reconciling','hold',$3,'CREATING','RECONCILING','PROVIDER_OUTCOME_UNKNOWN',clock_timestamp())`, [randomUUID(),row.bookingId,holdId]);
    }
    return (await inspectHold(client,holdId))!;
  });
}

/** Internal worker fence: leasing is durable before any later provider dispatch. */
export async function leaseSessionCommand(pool: Pool, holdId: string, workerId: string): Promise<{commandId:string;generation:bigint} | null> {
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(workerId)) throw new Error('Invalid worker identity');
  return locked(pool,holdId,async (client,row) => {
    if (row.holdState !== 'CREATING' || row.commandState !== 'PENDING') return null;
    const updated = await client.query<{lease_generation:string}>(`UPDATE provider_commands SET lease_owner=$2,lease_expires_at=clock_timestamp()+interval '2 minutes',lease_generation=lease_generation+1
      WHERE id=$1 AND lease_owner IS NULL AND first_submitted_at IS NULL RETURNING lease_generation::text`, [row.commandId,workerId]);
    return updated.rows[0] ? {commandId:row.commandId,generation:BigInt(updated.rows[0].lease_generation)} : null;
  });
}

/** Only a never-leased, never-submitted command can be abandoned without provider evidence. */
export async function abandonBeforeDispatch(pool: Pool, holdId: string): Promise<'ABANDONED' | 'ALREADY_ABANDONED' | 'UNSAFE'> {
  return locked(pool,holdId,async (client,row) => {
    if (row.holdState === 'RELEASED') return 'ALREADY_ABANDONED';
    const proof = await client.query<{safe:boolean}>(`SELECT state='PENDING' AND lease_generation=0 AND attempt_count=0 AND first_submitted_at IS NULL
      AND lease_owner IS NULL AND lease_expires_at IS NULL AND provider_request_id IS NULL AS safe FROM provider_commands WHERE id=$1`, [row.commandId]);
    if (row.holdState !== 'CREATING' || !row.claimBlocking || !proof.rows[0]?.safe) return 'UNSAFE';
    await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),last_error_code='ABANDONED_BEFORE_DISPATCH' WHERE id=$1", [row.commandId]);
    await client.query("UPDATE payment_attempts SET state='EXPIRED',version=version+1 WHERE id=$1", [row.attemptId]);
    await client.query("UPDATE inventory_claims SET released_at=clock_timestamp(),release_reason='ABANDONED_BEFORE_DISPATCH',version=version+1 WHERE hold_id=$1 AND released_at IS NULL", [holdId]);
    await client.query("UPDATE inventory_holds SET state='RELEASED',terminal_at=clock_timestamp(),version=version+1 WHERE id=$1", [holdId]);
    await client.query("UPDATE bookings SET status='EXPIRED',version=version+1 WHERE id=$1", [row.bookingId]);
    await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,prior_state,new_state,reason_code,occurred_at)
      VALUES($1,$2,'SERVICE','pending-hold-recovery','hold.released','hold',$3,'CREATING','RELEASED','ABANDONED_BEFORE_DISPATCH',clock_timestamp())`, [randomUUID(),row.bookingId,holdId]);
    return 'ABANDONED';
  });
}
