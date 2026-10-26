'use client';
import { useState } from 'react';
import { ActionFields, Confirm, day, unitName } from '../../workspace/ui';
type Unit={id:string;unit_key:string};
export function BlockForm({units,token,operationKey,blockId,initial}:{units:Unit[];token:string;operationKey:string;blockId?:string;initial?:{unitId:string;arrivalDate:string;departureDate:string}}){
  const [unit,setUnit]=useState(initial?.unitId??units[0]?.id??''),[arrival,setArrival]=useState(initial?.arrivalDate??''),[departure,setDeparture]=useState(initial?.departureDate??''),[reason,setReason]=useState('PRIVATE_USE'),[busy,setBusy]=useState(false);
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(arrival)&&/^\d{4}-\d{2}-\d{2}$/.test(departure)&&arrival<departure;
  let last='';if(valid){const d=new Date(`${departure}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-1);last=d.toISOString().slice(0,10);}
  return <form method="post" action={`/api/access/admin/block/${blockId?'replace':'create'}`} onSubmit={()=>setBusy(true)}><ActionFields token={token}/><input type="hidden" name="operationKey" value={operationKey}/>{blockId&&<input type="hidden" name="blockId" value={blockId}/>}
    <div className="form-grid"><label>Accommodation<select name="unitId" value={unit} onChange={e=>setUnit(e.target.value)} required>{units.map(u=><option key={u.id} value={u.id}>{unitName(u.unit_key)}</option>)}</select></label>
    <label>First occupied night<input name="arrivalDate" type="date" value={arrival} onChange={e=>setArrival(e.target.value)} required/></label><label>Reopen on (exclusive end)<input name="departureDate" type="date" value={departure} min={arrival||undefined} onChange={e=>setDeparture(e.target.value)} required/></label>
    <label>Block reason<select name="reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="PRIVATE_USE">Owner private use</option><option value="MAINTENANCE">Maintenance closure</option><option value="OTHER">Other operational closure</option></select></label></div>
    <output className="block-summary" aria-live="polite">{valid?`${unitName(units.find(u=>u.id===unit)?.unit_key??'')} · ${day(arrival)} to ${day(last)} occupied · available again ${day(departure)}`:'Select an accommodation and a valid date range to review the nights being blocked.'}</output>
    <Confirm>{blockId?'Release the original block and acquire this replacement atomically. If the new dates conflict, keep the original block.':'Reserve these nights for the selected noncommercial purpose. Existing bookings and holds cannot be overridden.'}</Confirm>
    <button disabled={!valid||busy}>{busy?'Saving block…':blockId?'Confirm replacement':'Confirm inventory block'}</button></form>;
}
