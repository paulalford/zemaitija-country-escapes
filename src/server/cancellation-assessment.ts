import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { authorize, type InternalAuthority } from './cancellation-authority';
import { cancellationAudit, queueCancellationNotice, withCancellationLock } from './cancellation';

export type MitigationEvidence={
  operationKey:string; expectedRevision:number; chargeCents:bigint; documentedLossCents:bigint; avoidedCostsCents:bigint;
  replacements:{bookingId:string;arrivalDate:string;departureDate:string;recoveredCents:bigint;provenance:string}[];
  evidenceRef:string; provenance:string; legalConstraints:string; rationale:string;
};
export function cancellationSettlement(paid:bigint,charge:bigint) {
  if(paid<0n||charge<0n)throw new Error('Invalid EUR cents');
  return {refundDue:paid>charge?paid-charge:0n,additionalChargeReview:charge>paid?charge-paid:0n};
}
export function assessmentAmounts(total:bigint,e:MitigationEvidence) {
  const recovered=e.replacements.reduce((sum,r)=>sum+r.recoveredCents,0n);
  if([total,e.chargeCents,e.documentedLossCents,e.avoidedCostsCents,...e.replacements.map(r=>r.recoveredCents)].some(n=>typeof n!=='bigint'||n<0n||n>9223372036854775807n))throw new Error('Invalid EUR cents');
  const net=e.documentedLossCents>e.avoidedCostsCents+recovered?e.documentedLossCents-e.avoidedCostsCents-recovered:0n;
  const cap=total*30n/100n;
  if(e.chargeCents>cap||e.chargeCents>net||e.documentedLossCents>total)throw new Error('Charge exceeds ceiling or documented net loss');
  return {net,cap,recovered};
}
/** Explicit finance approval; evidence is a complete replacement calculation for each immutable revision. */
export async function approveCancellationAssessment(pool:Pool,bookingId:string,authority:InternalAuthority,e:MitigationEvidence) {
  await authorize(pool,authority,'finance',bookingId);
  if(authority.kind!=='OPERATOR')throw new Error('Finance reviewer required');
  if(!/^[a-z0-9:_-]{8,150}$/i.test(e.operationKey)||!Number.isInteger(e.expectedRevision)||e.expectedRevision<0||
    [e.evidenceRef,e.provenance,e.legalConstraints,e.rationale].some(s=>typeof s!=='string'||!s.trim()||s.length>2000)||
    new Set(e.replacements.map(r=>r.bookingId)).size!==e.replacements.length)throw new Error('Complete, nonduplicated assessment evidence required');
  const serialized=JSON.stringify(e,(_,v)=>typeof v==='bigint'?v.toString():v);
  const fingerprint=createHash('sha256').update(serialized).digest('hex');
  return withCancellationLock(pool,bookingId,async(client,b)=>{
    await authorize(client,authority,'finance',bookingId);
    const a=(await client.query<{id:string;state:string;current_revision_no:number|null}>(
      'SELECT id,state,current_revision_no FROM cancellation_assessments WHERE booking_id=$1 FOR UPDATE',[bookingId])).rows[0];
    if(b.status!=='CANCELLED_GUEST'||!a||!['PENDING','FINAL','REVISION_PENDING'].includes(a.state))throw new Error('Late assessment unavailable');
    const prior=(await client.query<{id:string;charge_cents:string;evidence:{operationKey:string;fingerprint:string}}>(
      'SELECT id,charge_cents::text,evidence FROM assessment_revisions WHERE assessment_id=$1 ORDER BY revision_no DESC',[a.id])).rows;
    const replay=prior.find(r=>r.evidence?.operationKey===e.operationKey);
    if(replay){if(replay.evidence.fingerprint!==fingerprint)throw new Error('Assessment operation conflict');return {revisionId:replay.id,replayed:true};}
    if((a.current_revision_no??0)!==e.expectedRevision)throw new Error('Stale assessment revision');
    if(prior[0]&&e.chargeCents>BigInt(prior[0].charge_cents))throw new Error('Final charge cannot increase');
    const amounts=assessmentAmounts(BigInt(b.total_cents),e);
    for(const r of e.replacements) {
      if(!r.provenance?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(r.arrivalDate)||!/^\d{4}-\d{2}-\d{2}$/.test(r.departureDate)||
        r.arrivalDate>=r.departureDate||r.arrivalDate<b.arrival_date||r.departureDate>b.departure_date)throw new Error('Mitigation dates must belong to cancelled stay');
      const replacement=(await client.query<{paid:string}>(`SELECT
        COALESCE((SELECT sum(captured_cents) FROM payment_records WHERE booking_id=x.id),0)-
        COALESCE((SELECT sum(refunded_cents) FROM refund_records WHERE booking_id=x.id),0) paid
        FROM bookings x WHERE x.id=$1 AND x.unit_id=$2 AND x.status IN ('CONFIRMED','COMPLETED')
          AND x.arrival_date<=$3 AND x.departure_date>=$4`,[r.bookingId,b.unit_id,r.arrivalDate,r.departureDate])).rows[0];
      if(!replacement||BigInt(replacement.paid)<r.recoveredCents)throw new Error('Replacement recovery lacks captured revenue');
      const used=(await client.query<{used:string}>(`SELECT COALESCE(sum((item->>'recoveredCents')::numeric),0)::text used
        FROM cancellation_assessments ca JOIN assessment_revisions ar ON ar.assessment_id=ca.id AND ar.revision_no=ca.current_revision_no,
        jsonb_array_elements(ar.evidence->'replacements') item
        WHERE ca.booking_id<>$1 AND item->>'bookingId'=$2`,[bookingId,r.bookingId])).rows[0];
      if(BigInt(used.used)+r.recoveredCents>BigInt(replacement.paid))throw new Error('Replacement revenue already attributed');
    }
    if((await client.query(`SELECT 1 FROM refund_attempts ra JOIN refund_obligations ro ON ro.id=ra.obligation_id
      WHERE ro.booking_id=$1 AND ra.state IN ('REQUESTED','PROCESSING')`,[bookingId])).rowCount)throw new Error('Reconcile in-flight refund before revision');
    const p=(await client.query<{paid:string;owed:string}>(`SELECT
      COALESCE((SELECT sum(captured_cents) FROM payment_records WHERE booking_id=$1 AND allocation_state='ALLOCATED'),0)::text paid,
      COALESCE((SELECT sum(amount_cents) FROM refund_obligations WHERE booking_id=$1),0)::text owed`,[bookingId])).rows[0];
    const settlement=cancellationSettlement(BigInt(p.paid),e.chargeCents),target=settlement.refundDue;
    // Obligation totals already contain confirmed refunds and every unsent/failed residual exactly once.
    const increment=target>BigInt(p.owed)?target-BigInt(p.owed):0n,revisionId=randomUUID(),revision=e.expectedRevision+1;
    await client.query(`INSERT INTO assessment_revisions(id,assessment_id,revision_no,charge_cents,supportable_loss_cents,
      avoided_costs_cents,recovered_revenue_cents,evidence_ref,rationale,reviewed_by_admin_id,approved_at,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp(),$11)`,
      [revisionId,a.id,revision,e.chargeCents.toString(),amounts.net.toString(),e.avoidedCostsCents.toString(),amounts.recovered.toString(),
        e.evidenceRef,e.rationale,authority.adminId,{...JSON.parse(serialized),fingerprint}]);
    if(a.state==='FINAL')await client.query("UPDATE cancellation_assessments SET state='REVISION_PENDING' WHERE id=$1",[a.id]);
    await client.query("UPDATE cancellation_assessments SET state='FINAL',current_revision_no=$2 WHERE id=$1",[a.id,revision]);
    if(increment>0n)await client.query(`INSERT INTO refund_obligations(id,booking_id,assessment_revision_id,reason,amount_cents,business_key,currency)
      VALUES($1,$2,$3,'ASSESSMENT_REFUND',$4,$5,'EUR')`,[randomUUID(),bookingId,revisionId,increment.toString(),`assessment:${revisionId}`]);
    const audit=await cancellationAudit(client,b,authority,prior.length?'assessment.revised':'assessment.finalized','assessment_revision',revisionId,
      {revision,priorState:a.state,newState:'FINAL',priorChargeCents:prior[0]?.charge_cents??null,refundTargetCents:target.toString(),incrementalRefundCents:increment.toString(),
        additionalChargeReviewCents:settlement.additionalChargeReview.toString(),evidenceRef:e.evidenceRef},e.chargeCents);
    await queueCancellationNotice(client,b,audit,'ASSESSMENT_FINALIZED',`assessment:${revisionId}`);
    return {revisionId,replayed:false};
  });
}
