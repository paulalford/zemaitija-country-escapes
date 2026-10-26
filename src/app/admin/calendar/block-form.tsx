'use client';
import { usePresentation } from '@/i18n/client';
import { useState } from 'react';
import { ActionFields, Confirm} from '../../workspace/ui';
type Unit={id:string;unit_key:string};
export function BlockForm({units,token,operationKey,blockId,initial}:{units:Unit[];token:string;operationKey:string;blockId?:string;initial?:{unitId:string;arrivalDate:string;departureDate:string}}){
  const {t,day,unitName}=usePresentation();

  const [unit,setUnit]=useState(initial?.unitId??units[0]?.id??''),[arrival,setArrival]=useState(initial?.arrivalDate??''),[departure,setDeparture]=useState(initial?.departureDate??''),[reason,setReason]=useState('PRIVATE_USE'),[busy,setBusy]=useState(false);
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(arrival)&&/^\d{4}-\d{2}-\d{2}$/.test(departure)&&arrival<departure;
  let last='';if(valid){const d=new Date(`${departure}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-1);last=d.toISOString().slice(0,10);}
  return <form method="post" action={`/api/access/admin/block/${blockId?'replace':'create'}`} onSubmit={()=>setBusy(true)}><ActionFields token={token}/><input type="hidden" name="operationKey" value={operationKey}/>{blockId&&<input type="hidden" name="blockId" value={blockId}/>}
    <div className="form-grid"><label>{t("Accommodation")}<select name="unitId" value={unit} onChange={e=>setUnit(e.target.value)} required>{units.map(u=><option key={u.id} value={u.id}>{unitName(u.unit_key)}</option>)}</select></label>
    <label>{t("First occupied night")}<input name="arrivalDate" type="date" value={arrival} onChange={e=>setArrival(e.target.value)} required/></label><label>{t("Reopen on (exclusive end)")}<input name="departureDate" type="date" value={departure} min={arrival||undefined} onChange={e=>setDeparture(e.target.value)} required/></label>
    <label>{t("Block reason")}<select name="reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="PRIVATE_USE">{t("Owner private use")}</option><option value="MAINTENANCE">{t("Maintenance closure")}</option><option value="OTHER">{t("Other operational closure")}</option></select></label></div>
    <output className="block-summary" aria-live="polite">{valid?t('{unit} · {start} to {last} occupied · available again {end}',{unit:unitName(units.find(u=>u.id===unit)?.unit_key??''),start:day(arrival),last:day(last),end:day(departure)}):t("Select an accommodation and a valid date range to review the nights being blocked.")}</output>
    <Confirm>{blockId?t("Release the original block and acquire this replacement atomically. If the new dates conflict, keep the original block."):t("Reserve these nights for the selected noncommercial purpose. Existing bookings and holds cannot be overridden.")}</Confirm>
    <button disabled={!valid||busy}>{busy?t("Saving block…"):blockId?t("Confirm replacement"):t("Confirm inventory block")}</button></form>;
}
