'use client';
import { usePresentation } from '@/i18n/client';
import { useState } from 'react';
import { ActionFields, Confirm} from '../../../workspace/ui';
function euros(value:string):bigint|null {
  const m=/^(0|[1-9]\d{0,12})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  return m?BigInt(m[1])*100n+BigInt((m[2]??'').padEnd(2,'0')):null;
}
type Replacement={key:string;bookingId:string;arrivalDate:string;departureDate:string;revenue:string;provenance:string};
export function AssessmentForm({token,bookingId,operationKey,revision,capCents,priorCharge,totalCents}:{token:string;bookingId:string;operationKey:string;revision:number;capCents:string;priorCharge:string|null;totalCents:string}) {
  const {t,money}=usePresentation();

  const [charge,setCharge]=useState('0.00'),[loss,setLoss]=useState('0.00'),[avoided,setAvoided]=useState('0.00');
  const [reference,setReference]=useState(''),[provenance,setProvenance]=useState(''),[constraints,setConstraints]=useState(''),[rationale,setRationale]=useState('');
  const [replacements,setReplacements]=useState<Replacement[]>([]),[busy,setBusy]=useState(false);
  const proposed=euros(charge),gross=euros(loss),costs=euros(avoided),recovery=replacements.reduce((sum,r)=>sum+(euros(r.revenue)??0n),0n);
  const net=gross!==null&&costs!==null?(gross>costs+recovery?gross-costs-recovery:0n):null;
  const cap=BigInt(capCents),maximum=net===null?0n:[cap,net,...priorCharge===null?[]:[BigInt(priorCharge)]].reduce((a,b)=>a<b?a:b);
  const valid=proposed!==null&&gross!==null&&costs!==null&&proposed<=maximum&&gross<=BigInt(totalCents)&&replacements.every(r=>euros(r.revenue)!==null);
  const evidence={operationKey,expectedRevision:revision,chargeCents:proposed?.toString()??'INVALID',documentedLossCents:gross?.toString()??'INVALID',avoidedCostsCents:costs?.toString()??'INVALID',
    replacements:replacements.map(r=>({bookingId:r.bookingId,arrivalDate:r.arrivalDate,departureDate:r.departureDate,recoveredCents:euros(r.revenue)?.toString()??'INVALID',provenance:r.provenance})),
    evidenceRef:reference,provenance,legalConstraints:constraints,rationale};
  const update=(key:string,field:keyof Replacement,value:string)=>setReplacements(rows=>rows.map(r=>r.key===key?{...r,[field]:value}:r));
  return <form method="post" action="/api/access/admin/assessment" onSubmit={()=>setBusy(true)}><ActionFields token={token}/><input type="hidden" name="bookingId" value={bookingId}/><input type="hidden" name="evidence" value={JSON.stringify(evidence)}/>
    <p>{t('Current revision: {revision}. Accepted stay value: {total}. Policy ceiling: {cap}.',{revision,total:money(totalCents),cap:money(cap)})} {priorCharge!==null&&t('Previous approved charge: {amount}; a revision cannot increase it.',{amount:money(priorCharge)})}</p>
    <div className="form-grid"><label>{t("Documented accommodation loss (EUR)")}<input inputMode="decimal" required value={loss} onChange={e=>setLoss(e.target.value)}/></label><label>{t("Avoided costs (EUR)")}<input inputMode="decimal" required value={avoided} onChange={e=>setAvoided(e.target.value)}/></label></div>
    <h3>{t("Replacement booking recovery")}</h3><p>{t("Attribute only verified revenue from the same accommodation and the replaced nights. The service checks the booking, dates, captured revenue and prior attribution.")}</p>
    {!replacements.length&&<p className="muted">{t("No replacement revenue attributed in this revision.")}</p>}
    {replacements.map((r,i)=><fieldset key={r.key}><legend>{t("Replacement booking")} {i+1}</legend><label>{t("Reservation reference")}<input required value={r.bookingId} onChange={e=>update(r.key,'bookingId',e.target.value)}/></label><div className="form-grid"><label>{t("Replaced nights start")}<input type="date" required value={r.arrivalDate} onChange={e=>update(r.key,'arrivalDate',e.target.value)}/></label><label>{t("Replaced nights end (exclusive)")}<input type="date" required value={r.departureDate} onChange={e=>update(r.key,'departureDate',e.target.value)}/></label></div><label>{t("Attributed recovered revenue (EUR)")}<input inputMode="decimal" required value={r.revenue} onChange={e=>update(r.key,'revenue',e.target.value)}/></label><label>{t("Source of replacement evidence")}<textarea rows={2} required maxLength={2000} value={r.provenance} onChange={e=>update(r.key,'provenance',e.target.value)}/></label><button type="button" className="secondary" onClick={()=>setReplacements(rows=>rows.filter(x=>x.key!==r.key))}>{t("Remove replacement")} {i+1}</button></fieldset>)}
    <button type="button" className="secondary" disabled={replacements.length>=30} onClick={()=>setReplacements(rows=>[...rows,{key:crypto.randomUUID(),bookingId:'',arrivalDate:'',departureDate:'',revenue:'0.00',provenance:''}])}>{t("Add replacement recovery")}</button>
    <label>{t("Proposed cancellation charge (EUR)")}<input inputMode="decimal" required value={charge} onChange={e=>setCharge(e.target.value)}/></label>
    <div className="assessment-summary" aria-live="polite"><h3>{t("Review this calculation")}</h3><dl className="facts"><dt>{t("Documented loss")}</dt><dd>{gross===null?t("Enter a valid amount"):money(gross)}</dd><dt>{t("Less avoided costs")}</dt><dd>{costs===null?t("Enter a valid amount"):money(costs)}</dd><dt>{t("Less replacement recovery")}</dt><dd>{money(recovery)}</dd><dt>{t("Remaining documented loss")}</dt><dd>{net===null?t("Awaiting valid amounts"):money(net)}</dd><dt>{t("Maximum approvable charge")}</dt><dd>{money(maximum)}</dd><dt>{t("Proposed charge")}</dt><dd>{proposed===null?t("Enter a valid amount"):money(proposed)}</dd></dl>{!valid&&<p role="alert">{t("Enter valid EUR amounts and keep documented loss within the accepted stay value and the proposed charge within both the policy ceiling and documented net loss.")}</p>}</div>
    <label>{t("Supporting evidence reference")}<input required maxLength={2000} value={reference} onChange={e=>setReference(e.target.value)}/></label><label>{t("Source and verification of loss evidence")}<textarea required maxLength={2000} rows={3} value={provenance} onChange={e=>setProvenance(e.target.value)}/></label><label>{t("Applicable legal and contractual constraints")}<textarea required maxLength={2000} rows={3} value={constraints} onChange={e=>setConstraints(e.target.value)}/></label><label>{t("Reason for approving this charge")}<textarea required maxLength={2000} rows={3} value={rationale} onChange={e=>setRationale(e.target.value)}/></label>
    <Confirm>{t('I reviewed the evidence, avoided costs, attributed recovery and policy limits. Approve the proposed charge of {amount} as a new immutable financial decision.',{amount:proposed===null?t('The entered amount'):money(proposed)})}</Confirm><button className="danger" disabled={!valid||busy}>{busy?t("Recording assessment…"):t("Approve financial assessment")}</button>
  </form>;
}
