import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type NoticeKind='BALANCE_WARNING'|'BALANCE_DUE'|'BALANCE_OVERDUE';
type Candidate={id:string;guest_id:string;unit_id:string;locale:'lt'|'en'|'de';warning_at:Date;balance_due_at:Date;grace_ends_at:Date;accepted_at:Date};
const key=(b:Candidate,kind:NoticeKind)=>`${b.id}:${kind}:${(kind==='BALANCE_WARNING'?b.warning_at:b.balance_due_at).toISOString()}:guest:${b.locale}`;
export function noticeEligibility(b:Candidate,now:Date,outstanding:bigint):NoticeKind[] {
  if (outstanding<=0n) return [];
  const result:NoticeKind[]=[];
  if (now>=b.warning_at && now<b.balance_due_at) result.push('BALANCE_WARNING');
  if (now>=b.balance_due_at) result.push('BALANCE_DUE');
  if (now>b.balance_due_at) result.push('BALANCE_OVERDUE');
  return result;
}
async function outstanding(client:Pick<PoolClient,'query'>,id:string):Promise<bigint> {
  const r=await client.query<{due:string;paid:string}>(`SELECT o.amount_cents::text due,
    COALESCE((SELECT sum(a.amount_cents) FROM payment_allocations a WHERE a.obligation_id=o.id),0)::text paid
    FROM payment_obligations o WHERE o.booking_id=$1 AND o.kind='BALANCE'`,[id]);
  return r.rows[0]?BigInt(r.rows[0].due)-BigInt(r.rows[0].paid):0n;
}
/** Explicitly invoked bounded scheduler. Preview does not acquire locks or write. */
export async function scheduleBalanceNotices(pool:Pool,options:{now?:Date;limit?:number;dryRun?:boolean;bookingId?:string}={}) {
  const now=options.now??new Date(),limit=options.limit??25;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit<1 || limit>100) throw new RangeError('Invalid scheduler options');
  const candidates=await pool.query<Candidate>(`SELECT b.id,b.guest_id,b.unit_id,s.locale,b.warning_at,b.balance_due_at,b.grace_ends_at,b.accepted_at
    FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id
    JOIN payment_obligations o ON o.booking_id=b.id AND o.kind='BALANCE' AND o.amount_cents>0
    WHERE b.status='CONFIRMED' AND b.warning_at<=$1 AND ($3::uuid IS NULL OR b.id=$3) AND o.amount_cents>
      COALESCE((SELECT sum(pa.amount_cents) FROM payment_allocations pa WHERE pa.obligation_id=o.id),0) AND (
      (b.warning_at<=$1 AND b.balance_due_at>$1 AND NOT EXISTS
        (SELECT 1 FROM notification_outbox n WHERE n.booking_id=b.id AND n.event_type='BALANCE_WARNING')) OR
      (b.balance_due_at<=$1 AND NOT EXISTS
        (SELECT 1 FROM notification_outbox n WHERE n.booking_id=b.id AND n.event_type='BALANCE_DUE')) OR
      (b.balance_due_at<$1 AND NOT EXISTS
        (SELECT 1 FROM notification_outbox n WHERE n.booking_id=b.id AND n.event_type='BALANCE_OVERDUE')))
    ORDER BY b.warning_at,b.id LIMIT $2`,[now,limit,options.bookingId??null]);
  const results:{bookingId:string;queued:NoticeKind[];error?:string}[]=[];
  for (const candidate of candidates.rows) {
    if (options.dryRun) {
      const amount=await outstanding(pool,candidate.id);
      results.push({bookingId:candidate.id,queued:noticeEligibility(candidate,now,amount)});continue;
    }
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query('SELECT lock_acceptance_context($1,$2)',[candidate.unit_id,candidate.guest_id]);
      const fresh=await client.query<{status:string}>(`SELECT status FROM bookings WHERE id=$1 FOR UPDATE`,[candidate.id]);
      const amount=await outstanding(client,candidate.id);
      const kinds=fresh.rows[0]?.status==='CONFIRMED'?noticeEligibility(candidate,now,amount):[];
      const queued:NoticeKind[]=[];
      for (const kind of kinds) {
        const operationKey=key(candidate,kind),auditId=randomUUID();
        const existing=await client.query('SELECT id FROM notification_outbox WHERE idempotency_key=$1',[operationKey]);
        if (existing.rowCount) continue;
        await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
          operation_key,occurred_at,details) VALUES($1,$2,'SERVICE','nonpayment-notices',$3,'booking',$2,$4,$5,$6)`,
          [auditId,candidate.id,`notice.${kind.toLowerCase()}`,operationKey,now,{deadline:candidate.balance_due_at.toISOString(),graceEnds:candidate.grace_ends_at.toISOString()}]);
        await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
          recipient_ref,locale,idempotency_key,due_at,state) VALUES($1,$2,$3,$4,'GUEST',$5,$6,$7,$8,'QUEUED')
          ON CONFLICT (idempotency_key) DO NOTHING`,[randomUUID(),candidate.id,auditId,kind,candidate.guest_id,candidate.locale,operationKey,now]);
        queued.push(kind);
      }
      await client.query('COMMIT');results.push({bookingId:candidate.id,queued});
    } catch(e) {await client.query('ROLLBACK').catch(()=>{});results.push({bookingId:candidate.id,queued:[],error:e instanceof Error?e.name:'UNKNOWN'});}
    finally {client.release();}
  }
  return results;
}

export function formatVilnius(instant:Date,locale:'lt'|'en'|'de'):string {
  const tag={lt:'lt-LT',en:'en-GB',de:'de-DE'}[locale];
  return `${new Intl.DateTimeFormat(tag,{timeZone:'Europe/Vilnius',dateStyle:'long',timeStyle:'short'}).format(instant)} (Europe/Vilnius)`;
}
export function noticeContent(kind:NoticeKind,locale:'lt'|'en'|'de',deadline:Date,grace:Date,now:Date) {
  const due=formatVilnius(deadline,locale),left=Math.max(0,Math.floor((deadline.getTime()-now.getTime())/60000));
  const graceLeft=Math.max(0,Math.floor((grace.getTime()-now.getTime())/60000));
  const remaining=(minutes:number)=>locale==='lt'?`${minutes} min.`:locale==='de'?`${minutes} Min.`:`${minutes} min`;
  const content={
    lt:{BALANCE_WARNING:`Jūsų užsakymo likutis turi būti sumokėtas iki ${due}. Liko ${remaining(left)}.`,BALANCE_DUE:`Šiandien suėjo likučio mokėjimo terminas: ${due}. Jei jau sumokėjote, mokėjimą patikrinsime.`,BALANCE_OVERDUE:`Likučio mokėjimo terminas ${due} praėjo. Iki galimo užsakymo atšaukimo liko ${remaining(graceLeft)}. Mokėjimą patikrinsime prieš priimdami sprendimą.`},
    en:{BALANCE_WARNING:`Your booking balance is due by ${due}. Time remaining: ${remaining(left)}.`,BALANCE_DUE:`Your booking balance deadline has arrived: ${due}. If you have paid, we will verify the payment.`,BALANCE_OVERDUE:`Your booking balance was due ${due}. Time remaining before possible cancellation: ${remaining(graceLeft)}. We will verify payment before deciding.`},
    de:{BALANCE_WARNING:`Der Restbetrag Ihrer Buchung ist bis ${due} fällig. Verbleibende Zeit: ${remaining(left)}.`,BALANCE_DUE:`Die Zahlungsfrist für den Restbetrag ist erreicht: ${due}. Wenn Sie bereits bezahlt haben, prüfen wir die Zahlung.`,BALANCE_OVERDUE:`Der Restbetrag war bis ${due} fällig. Bis zu einer möglichen Stornierung verbleiben ${remaining(graceLeft)}. Vor einer Entscheidung prüfen wir die Zahlung.`},
  };
  return content[locale][kind];
}
