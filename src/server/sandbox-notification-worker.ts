import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { accessLinkForNotice, GuestAccessRevoked } from './guest-management';
import { financialNoticeContent, financialNoticeEvents } from './financial-notifications';
import { formatVilnius, noticeContent, type NoticeKind } from './nonpayment-notices';

type Locale='lt'|'en'|'de';
type Row={id:string;booking_id:string|null;provider_incident_id:string|null;recipient_ref:string|null;recipient_kind:string;locale:Locale;event_type:string;idempotency_key:string;
  balance_due_at:Date|null;grace_ends_at:Date|null;status:string|null;retention_state:string|null;attempt_no:number;
  audit_details:Record<string,string>|null; audit_amount:string|null;total_cents:string|null;outstandingCents?:bigint};
export type SandboxMessage={key:string;recipientKind:string;recipientRef:string|null;locale:Locale;body:string};
export interface SandboxTransport {
  readonly sandbox:true;
  send(message:SandboxMessage):Promise<{messageId:string}>;
  /** Null means provider confirms no message exists; undefined means outcome remains unknown. */
  lookup(key:string):Promise<{messageId:string}|null|undefined>;
}
export class MemorySandboxTransport implements SandboxTransport {
  readonly sandbox=true;
  readonly messages=new Map<string,{messageId:string;message:SandboxMessage}>();
  async send(message:SandboxMessage) {
    const prior=this.messages.get(message.key);
    if (prior) return {messageId:prior.messageId};
    const messageId=`sandbox:${randomUUID()}`;
    this.messages.set(message.key,{messageId,message});return {messageId};
  }
  async lookup(key:string) {const prior=this.messages.get(key);return prior?{messageId:prior.messageId}:null;}
}
const operationsOnly=new Set(['UNALLOCATABLE_CAPTURE','PAYMENT_EVIDENCE_MISMATCH','DELIVERY_FAILURE','REFUND_INTERVENTION']);
const supported=new Set(['GUEST_ACCESS_LINK','BOOKING_CONFIRMED','PAID_IN_FULL','BALANCE_WARNING','BALANCE_DUE','BALANCE_OVERDUE','CANCELLED_NONPAYMENT',...financialNoticeEvents,...operationsOnly]);
const retryMinutes=[1,5,30,120,720];
const jitter=(key:string,attempt:number)=>[...key].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,attempt)%30;
function obsolete(row:Row,now:Date,outstanding:bigint):string|null {
  if (row.event_type==='GUEST_ACCESS_LINK' || operationsOnly.has(row.event_type)) return null;
  if (row.event_type==='CANCELLED_NONPAYMENT'||financialNoticeEvents.includes(row.event_type)) return null;
  if (row.status!=='CONFIRMED') return 'BOOKING_NOT_CONFIRMED';
  if (row.event_type==='BOOKING_CONFIRMED' || row.event_type==='PAID_IN_FULL') return null;
  if (outstanding<=0n) return 'BALANCE_PAID';
  if (row.event_type==='BALANCE_WARNING' && row.balance_due_at && now>=row.balance_due_at) return 'WARNING_WINDOW_ENDED';
  return null;
}
function body(row:Row,now:Date):string {
  if(row.event_type==='GUEST_ACCESS_LINK')return {
    lt:'Tvarkykite demonstracinį užsakymą naudodami toliau pateiktą vienkartinę nuorodą. Ji galioja 15 minučių.',
    en:'Manage your synthetic booking using the single-use link below. It expires in 15 minutes.',
    de:'Verwalten Sie Ihre fiktive Buchung über den einmalig nutzbaren Link unten. Er ist 15 Minuten gültig.',
  }[row.locale];
  if(financialNoticeEvents.includes(row.event_type))return financialNoticeContent(row.event_type,row.locale,row.audit_amount??row.audit_details?.amountCents??null,row.total_cents);
  const subject=row.provider_incident_id?`incident ${row.provider_incident_id}`:`booking ${row.booking_id}`;
  if (row.event_type==='UNALLOCATABLE_CAPTURE') return {
    lt:`Nepriskirtas gautas mokėjimas (${subject}). Patikrinkite mokėjimo įrodymus, visos sumos grąžinimo prievolę ir svečio informavimą. Tęskite patvirtintą grąžinimo procesą. Rezervacijos neatkurkite; grąžinimo nelaikykite įvykdytu, kol jis nepatvirtintas.`,
    en:`Unallocatable captured payment (${subject}). Review payment evidence, the full refund obligation and the guest status update. Follow the approved refund process. Do not restore the booking or report a refund as completed before verification.`,
    de:`Nicht zuordenbare eingezogene Zahlung (${subject}). Prüfen Sie Zahlungsnachweise, die vollständige Erstattungsverpflichtung und die Gastinformation. Folgen Sie dem freigegebenen Erstattungsprozess. Stellen Sie die Buchung nicht wieder her und melden Sie eine Erstattung erst nach Bestätigung als abgeschlossen.`,
  }[row.locale];
  if (row.event_type==='PAYMENT_EVIDENCE_MISMATCH') return {
    lt:`Mokėjimo įrodymų neatitiktis (${subject}). Audito žurnale raskite izoliuotą mokėjimo bandymą ir ištirkite teikėjo duomenis. Nepatvirtinkite mokėjimo pagal prieštaringus duomenis; jei paveiktos svečio lėšos, patikrinkite svečio informavimą.`,
    en:`Payment evidence mismatch (${subject}). Locate the quarantined payment attempt in the audit trail and investigate authoritative provider evidence. Do not confirm payment from conflicting evidence; check the guest status update if guest funds are affected.`,
    de:`Widersprüchliche Zahlungsnachweise (${subject}). Suchen Sie den isolierten Zahlungsversuch im Auditprotokoll und prüfen Sie maßgebliche Anbieternachweise. Bestätigen Sie keine Zahlung anhand widersprüchlicher Daten; prüfen Sie die Gastinformation, wenn Gastgelder betroffen sind.`,
  }[row.locale];
  if (row.event_type==='DELIVERY_FAILURE') return `Sandbox notice delivery failed for ${subject}. Investigate the outbox.`;
  if (!row.booking_id || !row.balance_due_at || !row.grace_ends_at || row.total_cents===null) throw new Error('Booking notice context missing');
  const money=(cents:bigint)=>`${new Intl.NumberFormat(row.locale).format(cents/100n)}${row.locale==='en'?'.':','}${(cents%100n).toString().padStart(2,'0')} EUR`;
  if (row.event_type==='PAID_IN_FULL') return {
    lt:`Jūsų užsakymas visiškai apmokėtas. Patvirtinta mokėjimų suma: ${money(BigInt(row.total_cents))}.`,
    en:`Your booking is paid in full. Verified payments total ${money(BigInt(row.total_cents))}.`,
    de:`Ihre Buchung ist vollständig bezahlt. Bestätigte Zahlungen insgesamt: ${money(BigInt(row.total_cents))}.`,
  }[row.locale];
  if (row.event_type==='BOOKING_CONFIRMED') {
    const left=row.outstandingCents??0n,deadline=formatVilnius(row.balance_due_at,row.locale);
    return {
      lt:`Jūsų užsakymas patvirtintas. Bendra kaina: ${money(BigInt(row.total_cents))}. ${left>0n?`Likutis ${money(left)} turi būti sumokėtas iki ${deadline}.`:'Užsakymas visiškai apmokėtas.'}`,
      en:`Your booking is confirmed. Total price: ${money(BigInt(row.total_cents))}. ${left>0n?`The remaining balance of ${money(left)} is due by ${deadline}.`:'Your booking is paid in full.'}`,
      de:`Ihre Buchung ist bestätigt. Gesamtpreis: ${money(BigInt(row.total_cents))}. ${left>0n?`Der Restbetrag von ${money(left)} ist bis ${deadline} fällig.`:'Ihre Buchung ist vollständig bezahlt.'}`,
    }[row.locale];
  }
  if (row.event_type==='CANCELLED_NONPAYMENT') return {
    lt:'Užsakymas atšauktas nesumokėjus likučio. Patvirtinti mokėjimai lieka apskaitoje; grąžintina suma bus tvarkoma atskirai.',
    en:'Your booking was cancelled because the balance remained unpaid. Verified payments remain recorded; any refund due is handled separately.',
    de:'Ihre Buchung wurde wegen eines offenen Restbetrags storniert. Bestätigte Zahlungen bleiben erfasst; eine fällige Erstattung wird gesondert bearbeitet.',
  }[row.locale];
  return noticeContent(row.event_type as NoticeKind,row.locale,row.balance_due_at,row.grace_ends_at,now);
}

/** Lock outbox first, then validate the exact unfinished attempt and lease. */
async function lockSendingAttempt(client:PoolClient,notificationId:string,attemptId:string,clock:Date|(()=>Date),expired=false):Promise<boolean> {
  const n=(await client.query<{state:string;lease_until:Date|null}>(
    'SELECT state,lease_until FROM notification_outbox WHERE id=$1 FOR UPDATE',[notificationId])).rows[0];
  if (!n || n.state!=='SENDING' || !n.lease_until) return false;
  const a=(await client.query<{id:string;result:string}>(`SELECT id,result FROM notification_delivery_attempts
    WHERE notification_id=$1 ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE`,[notificationId])).rows[0];
  const at=typeof clock==='function'?clock():clock;
  return a?.id===attemptId && a.result==='STARTED' && (expired?n.lease_until<=at:n.lease_until>at);
}
/** At most one delivery per call. Expired SENDING leases require explicit investigation. */
export async function deliverOneSandboxNotice(pool:Pool,transport:SandboxTransport,now=new Date(),bookingId?:string,providerIncidentId?:string):Promise<string|null> {
  if (transport.sandbox!==true || !Number.isFinite(now.getTime())) throw new Error('Sandbox transport and valid instant required');
  const wallStarted=Date.now();
  const completionTime=()=>new Date(now.getTime()+Math.max(0,Date.now()-wallStarted));
  const client=await pool.connect();let row:Row|undefined,attemptId:string|undefined;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const found=await client.query<Row>(`SELECT n.id,n.booking_id,n.provider_incident_id,n.recipient_ref,n.recipient_kind,n.locale,n.event_type,n.idempotency_key,
      b.balance_due_at,b.grace_ends_at,b.status,g.retention_state,s.total_cents::text,a.details audit_details,a.amount_cents::text audit_amount,
      (SELECT count(*)::int FROM notification_delivery_attempts a WHERE a.notification_id=n.id) attempt_no
      FROM notification_outbox n JOIN audit_events a ON a.id=n.source_audit_event_id LEFT JOIN bookings b ON b.id=n.booking_id
      LEFT JOIN price_snapshots s ON s.booking_id=b.id
      LEFT JOIN guests g ON g.id=n.recipient_ref
      WHERE n.state IN ('QUEUED','RETRY_WAIT') AND n.due_at<=$1 AND n.event_type=ANY($2::text[])
        AND ($3::uuid IS NULL OR n.booking_id=$3)
        AND ($4::uuid IS NULL OR n.provider_incident_id=$4)
      ORDER BY n.due_at,n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,[now,[...supported],bookingId??null,providerIncidentId??null]);
    row=found.rows[0];
    if (!row) {await client.query('COMMIT');return null;}
    if (operationsOnly.has(row.event_type) && (row.recipient_kind!=='OPERATIONS' || row.recipient_ref!==null)) throw new Error('Operational notice requires operations sink');
    const due=await client.query<{due:string;paid:string}>(`SELECT o.amount_cents::text due,
      COALESCE((SELECT sum(a.amount_cents) FROM payment_allocations a WHERE a.obligation_id=o.id),0)::text paid
      FROM payment_obligations o WHERE o.booking_id=$1 AND o.kind='BALANCE'`,[row.booking_id]);
    const outstanding=due.rows[0]?BigInt(due.rows[0].due)-BigInt(due.rows[0].paid):0n;
    row.outstandingCents=outstanding;
    const stale=obsolete(row,now,outstanding);
    if (stale) {
      await client.query("UPDATE notification_outbox SET state='SUPPRESSED',suppression_reason=$2 WHERE id=$1",[row.id,stale]);
      await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
        reason_code,occurred_at) VALUES($1,$2,'SERVICE','sandbox-notification-worker','notice.suppressed','notification',$3,$4,$5)`,
        [randomUUID(),row.booking_id,row.id,stale,now]);
      await client.query('COMMIT');return 'SUPPRESSED';
    }
    if (row.recipient_kind==='GUEST' && row.retention_state!=='SYNTHETIC') throw new Error('Recipient is not synthetic');
    attemptId=randomUUID();
    await client.query("UPDATE notification_outbox SET state='SENDING',lease_until=$2 WHERE id=$1",[row.id,new Date(now.getTime()+60_000)]);
    await client.query(`INSERT INTO notification_delivery_attempts(id,notification_id,attempt_no,started_at,result)
      VALUES($1,$2,$3,$4,'STARTED')`,[attemptId,row.id,row.attempt_no+1,now]);
    await client.query('COMMIT');
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally {client.release();}
  if (!row || !attemptId) return null;
  if (row.event_type.startsWith('BALANCE_')) {
    const fresh=await pool.query<{status:string;due:string;paid:string}>(`SELECT b.status,o.amount_cents::text due,
      COALESCE((SELECT sum(a.amount_cents) FROM payment_allocations a WHERE a.obligation_id=o.id),0)::text paid
      FROM bookings b JOIN payment_obligations o ON o.booking_id=b.id AND o.kind='BALANCE' WHERE b.id=$1`,[row.booking_id]);
    const f=fresh.rows[0];
    const stale=f?obsolete({...row,status:f.status},now,BigInt(f.due)-BigInt(f.paid)):'BOOKING_MISSING';
    if (stale) {
      const stop=await pool.connect();
      try {
        await stop.query('BEGIN');
        if (!await lockSendingAttempt(stop,row.id,attemptId,completionTime)) {await stop.query('COMMIT');return 'STALE';}
        await stop.query("UPDATE notification_outbox SET state='SUPPRESSED',lease_until=NULL,suppression_reason=$2 WHERE id=$1 AND state='SENDING'",[row.id,stale]);
        await stop.query("UPDATE notification_delivery_attempts SET result='SUPPRESSED',finished_at=$2,error_code=$3 WHERE id=$1",[attemptId,now,stale]);
        await stop.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at)
          VALUES($1,$2,'SERVICE','sandbox-notification-worker','notice.suppressed','notification',$3,$4,$5)`,
          [randomUUID(),row.booking_id,row.id,stale,now]);
        await stop.query('COMMIT');return 'SUPPRESSED';
      } catch(e) {await stop.query('ROLLBACK').catch(()=>{});throw e;}
      finally {stop.release();}
    }
  }
  let result:{messageId:string}|undefined,errorCode:string|null=null,uncertain=false,suppressed=false;
  try {const prior=await transport.lookup(row.idempotency_key);
    if (prior===undefined) uncertain=true;
    else if (prior) result=prior;
    else {
      const check=await pool.connect();
      let authoritative=false;
      try {
        await check.query('BEGIN');
        authoritative=await lockSendingAttempt(check,row.id,attemptId,completionTime);
        await check.query('COMMIT');
      } catch(e) {await check.query('ROLLBACK').catch(()=>{});throw e;}
      finally {check.release();}
      if (!authoritative) return 'STALE';
      const link=row.recipient_kind==='GUEST' && (row.event_type==='GUEST_ACCESS_LINK' || process.env.ACCESS_SECRET && process.env.APP_ORIGIN)
        ? await accessLinkForNotice(pool,row.id,attemptId) : null;
      result=await transport.send({key:row.idempotency_key,recipientKind:row.recipient_kind,
        recipientRef:row.recipient_ref,locale:row.locale,body:body(row,now)+(link?`\n\n${link}`:'')});
    }
  } catch(e) {
    if(e instanceof GuestAccessRevoked)suppressed=true;
    else {
      errorCode=e instanceof Error?e.name:'TRANSPORT_ERROR';
      try {const check=await transport.lookup(row.idempotency_key);if (check) result=check;else uncertain=check===undefined;}
      catch {uncertain=true;}
    }
  }
  const finish=await pool.connect();
  try {
    await finish.query('BEGIN');
    if (!await lockSendingAttempt(finish,row.id,attemptId,completionTime)) {
      await finish.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at,details)
        VALUES($1,$2,'SERVICE','sandbox-notification-worker','notification.stale_completion','notification',$3,'LEASE_LOST',$4,$5)`,
        [randomUUID(),row.booking_id,row.id,completionTime(),{attemptId,providerMessageId:result?.messageId??null,outcome:result?'ACCEPTED':uncertain?'UNKNOWN':'FAILED'}]);
      await finish.query('COMMIT');return 'STALE';
    }
    const finishedAt=completionTime();
    let finalState='SENT';
    if (suppressed) {
      finalState='SUPPRESSED';
      await finish.query("UPDATE notification_delivery_attempts SET result='SUPPRESSED',finished_at=$2,error_code='GUEST_ACCESS_REVOKED' WHERE id=$1",[attemptId,finishedAt]);
      await finish.query("UPDATE notification_outbox SET state='SUPPRESSED',lease_until=NULL,suppression_reason='GUEST_ACCESS_REVOKED' WHERE id=$1",[row.id]);
      await finish.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at)
        VALUES($1,$2,'SERVICE','sandbox-notification-worker','notice.suppressed','notification',$3,'GUEST_ACCESS_REVOKED',$4)`,
        [randomUUID(),row.booking_id,row.id,finishedAt]);
    } else if (result) {
      await finish.query("UPDATE notification_delivery_attempts SET result='ACCEPTED',finished_at=$2,provider_message_id=$3 WHERE id=$1",[attemptId,finishedAt,result.messageId]);
      await finish.query("UPDATE notification_outbox SET state='SENT',lease_until=NULL,provider_message_id=$2 WHERE id=$1",[row.id,result.messageId]);
    } else {
      const exhausted=row.attempt_no>=retryMinutes.length;
      const failure=uncertain||exhausted||errorCode==='PermanentDeliveryError';
      finalState=uncertain?'UNKNOWN':failure?'FAILED':'RETRY_WAIT';
      await finish.query(`UPDATE notification_delivery_attempts SET result=$2,finished_at=$3,error_code=$4 WHERE id=$1`,
        [attemptId,uncertain?'UNKNOWN':failure?'PERMANENT':'TRANSIENT',finishedAt,errorCode??'UNKNOWN']);
      await finish.query(`UPDATE notification_outbox SET state=$2,lease_until=NULL,due_at=$3 WHERE id=$1`,
        [row.id,failure?'FAILED':'RETRY_WAIT',new Date(finishedAt.getTime()+(retryMinutes[row.attempt_no]??720)*60_000+jitter(row.idempotency_key,row.attempt_no)*1000)]);
      if (failure && row.event_type!=='DELIVERY_FAILURE') {
        const auditId=randomUUID();
        await finish.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
          reason_code,occurred_at) VALUES($1,$2,'SERVICE','sandbox-notification-worker','notification.delivery_alert','notification',$3,$4,$5)`,
          [auditId,row.booking_id,row.id,uncertain?'UNKNOWN_OUTCOME':errorCode??'RETRY_EXHAUSTED',now]);
        await finish.query(`INSERT INTO notification_outbox(id,booking_id,provider_incident_id,source_audit_event_id,event_type,recipient_kind,locale,
          idempotency_key,due_at,state) VALUES($1,$2,$3,$4,'DELIVERY_FAILURE','OPERATIONS','en',$5,$6,'QUEUED')
          ON CONFLICT(idempotency_key) DO NOTHING`,[randomUUID(),row.booking_id,row.provider_incident_id,auditId,`delivery-failure:${row.id}`,now]);
      }
    }
    await finish.query('COMMIT');return finalState;
  } catch(e) {await finish.query('ROLLBACK').catch(()=>{});throw e;}
  finally {finish.release();}
}

/** An expired sending lease is unknown until the sandbox provider is queried. */
export async function recoverExpiredSandboxDelivery(pool:Pool,transport:SandboxTransport,now=new Date(),bookingId?:string,providerIncidentId?:string):Promise<string|null> {
  if (transport.sandbox!==true || !Number.isFinite(now.getTime())) throw new Error('Sandbox transport and valid instant required');
  const row=(await pool.query<{id:string;idempotency_key:string;booking_id:string|null;provider_incident_id:string|null;attempt_id:string}>(`SELECT n.id,n.idempotency_key,n.booking_id,n.provider_incident_id,
      (SELECT a.id FROM notification_delivery_attempts a WHERE a.notification_id=n.id ORDER BY a.attempt_no DESC LIMIT 1) attempt_id
    FROM notification_outbox n WHERE n.state='SENDING' AND n.lease_until<=$1
      AND ($2::uuid IS NULL OR n.booking_id=$2) AND ($3::uuid IS NULL OR n.provider_incident_id=$3)
    ORDER BY n.lease_until,n.id LIMIT 1`,[now,bookingId??null,providerIncidentId??null])).rows[0];
  if (!row) return null;
  let known:{messageId:string}|null|undefined;
  try {known=await transport.lookup(row.idempotency_key);} catch {known=undefined;}
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await lockSendingAttempt(client,row.id,row.attempt_id,now,true)) {await client.query('COMMIT');return null;}
    if (known) {
      await client.query("UPDATE notification_outbox SET state='SENT',lease_until=NULL,provider_message_id=$2 WHERE id=$1",[row.id,known.messageId]);
      await client.query("UPDATE notification_delivery_attempts SET result='ACCEPTED',finished_at=$2,provider_message_id=$3 WHERE id=$1",[row.attempt_id,now,known.messageId]);
    } else {
      // No record does not rule out a still-running send from the expired worker.
      // Quarantine it for investigation instead of creating a concurrent retry.
      await client.query("UPDATE notification_outbox SET state='FAILED',lease_until=NULL WHERE id=$1",[row.id]);
      await client.query("UPDATE notification_delivery_attempts SET result='UNKNOWN',finished_at=$2,error_code='UNKNOWN_OUTCOME' WHERE id=$1",[row.attempt_id,now]);
      const auditId=randomUUID();
      await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at)
        VALUES($1,$2,'SERVICE','sandbox-notification-worker','notification.delivery_alert','notification',$3,'UNKNOWN_OUTCOME',$4)`,[auditId,row.booking_id,row.id,now]);
      await client.query(`INSERT INTO notification_outbox(id,booking_id,provider_incident_id,source_audit_event_id,event_type,recipient_kind,locale,idempotency_key,due_at,state)
        VALUES($1,$2,$3,$4,'DELIVERY_FAILURE','OPERATIONS','en',$5,$6,'QUEUED') ON CONFLICT(idempotency_key) DO NOTHING`,
        [randomUUID(),row.booking_id,row.provider_incident_id,auditId,`delivery-failure:${row.id}`,now]);
    }
    await client.query('COMMIT');return known?'SENT':'UNKNOWN';
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally {client.release();}
}
