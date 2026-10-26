import { getPresentation } from '@/i18n/server';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { pool } from '@/db/client';
import { managementCalendar, managementHistory, localDate } from '@/server/accommodation-management';
import { AccessDenied, mintAction } from '@/server/access';
import { workspaceSession } from '../../workspace/session';
import { ActionFields, Confirm, Notice, Status} from '../../workspace/ui';
import { BlockForm } from './block-form';
const plus=(d:string,n:number)=>{const x=new Date(`${d}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
export default async function Calendar({searchParams}:{searchParams:Promise<{date?:string;view?:string;unit?:string;notice?:string}>}){
  const {t,day,instant,unitName,locale,href,statusLabel}=await getPresentation();

  const {raw}=await workspaceSession('admin'),p=await searchParams;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vilnius',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const date=localDate.safeParse(p.date).success?p.date!:today,week=p.view==='week';
  const start=week?date:`${date.slice(0,7)}-01`;
  const nextMonth=new Date(`${start}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const end=week?plus(start,7):nextMonth.toISOString().slice(0,10);
  let v;try{v=await managementCalendar(pool,raw,start,end,p.unit||undefined);}catch(e){if(e instanceof AccessDenied)return <><h1>{t("Accommodation calendar")}</h1><p className="notice">{t("Calendar access requires an operations or administrator role with permission for the selected accommodation.")}</p></>;throw e;}
  const previous=week?plus(start,-7):new Date(Date.UTC(nextMonth.getUTCFullYear(),nextMonth.getUTCMonth()-2,1,12)).toISOString().slice(0,10);
  const calendarHref=(d:string,view=week?'week':'month')=>href(`/admin/calendar?date=${d}&view=${view}${p.unit?`&unit=${encodeURIComponent(p.unit)}`:''}`);
  const dates:string[]=[];for(let d=start;d<end;d=plus(d,1))dates.push(d);
  const history=await managementHistory(pool,raw,v.units.map(u=>u.id));
  const createToken=v.units.length?await mintAction(pool,raw,'admin','admin/block/create'):null;
  const releaseToken=await mintAction(pool,raw,'admin','admin/block/release'),replaceToken=await mintAction(pool,raw,'admin','admin/block/replace');
  return <><Notice code={p.notice}/><div className="page-heading"><div><h1>{t("Accommodation calendar")}</h1><p>{day(start)} {t("to")} {day(plus(end,-1))} {t("· Europe/Vilnius")}</p></div><Link href={calendarHref(today)}>{t("Today")}</Link></div>
    <div className="calendar-toolbar"><nav aria-label={t("Calendar dates")}><Link href={calendarHref(previous)}>{t("Previous")}</Link><Link href={calendarHref(end)}>{t("Next")}</Link></nav><nav aria-label={t("Calendar view")}><Link aria-current={!week?'page':undefined} href={calendarHref(date,'month')}>{t("Month")}</Link><Link aria-current={week?'page':undefined} href={calendarHref(date,'week')}>{t("Week")}</Link></nav></div>
    <form method="get" className="calendar-filter"><input type="hidden" name="date" value={date}/><input type="hidden" name="view" value={week?'week':'month'}/><label>{t("Accommodation")}<select name="unit" defaultValue={p.unit??''}><option value="">{t("All permitted accommodations")}</option>{v.units.map(u=><option key={u.id} value={u.id}>{unitName(u.unit_key)}</option>)}</select></label><button className="secondary">{t("Apply filter")}</button></form>
    {!v.units.length?<p className="notice">{t("No accommodations are assigned. An administrator must grant access before you can inspect or manage inventory.")}</p>:<>
    <p id="calendar-help" className="muted">{t("Every cell represents an occupied night. The departure date is available unless another active claim occupies it. Pending holds remain unavailable until reconciled. Scroll the table to inspect all dates, or use the list below.")}</p>
    <p className="muted">{t("BKG: confirmed booking · HLD: pending or unresolved hold · PVT: owner private use · MNT: maintenance · OTH: other operator closure")}</p>
    <div className="table-wrap calendar-wrap" tabIndex={0} role="region" aria-label={t("Nightly accommodation calendar")} aria-describedby="calendar-help"><table className={`calendar-grid ${week?'calendar-week':'calendar-month'}`}><caption>{t("Nightly availability. Today:")} {day(today)}</caption><thead><tr><th>{t("Accommodation")}</th>{dates.map(d=><th key={d} scope="col" aria-current={d===today?'date':undefined}>{new Intl.DateTimeFormat(locale,{day:'numeric',weekday:'short',timeZone:'Europe/Vilnius'}).format(new Date(`${d}T12:00:00Z`))}{d===today&&<small>{t("Today")}</small>}</th>)}</tr></thead><tbody>{v.units.map(u=><tr key={u.id}><th scope="row">{unitName(u.unit_key)}{!u.enabled&&<small>{t("New quotes disabled")}</small>}</th>{dates.map(d=>{const c=v.occupancy.find(c=>c.unit_id===u.id&&c.arrival_date<=d&&c.departure_date>d);return <td key={d} className={c?'occupied':'available'} aria-current={d===today?'date':undefined}><span>{c?(week?<Status value={c.status}/>:<span className={`status status-${c.status.toLowerCase()}`} title={statusLabel(c.status)} aria-label={statusLabel(c.status)}>{{PRIVATE_USE:'PVT',MAINTENANCE:'MNT',OTHER:'OTH',PENDING_HOLD:'HLD',CONFIRMED_BOOKING:'BKG'}[c.status as 'PRIVATE_USE']??'BKG'}</span>):week?t("Available"):t("Free")}</span></td>;})}</tr>)}</tbody></table></div>
    <section><h2>{t("Occupied periods")}</h2>{v.occupancy.length?<div className="period-list">{await Promise.all(v.occupancy.map(async c=>{
      const u=v.units.find(u=>u.id===c.unit_id)!;
      return <article key={c.id}><div className="period-heading"><h3>{unitName(u.unit_key)}</h3><Status value={c.status}/></div><p>{day(c.arrival_date)} {t("to")} {day(plus(c.departure_date,-1))} {t("occupied · Reopens")} {day(c.departure_date)}</p>
      {c.block_id&&<details className="consequential"><summary>{t("Manage operator block")}</summary><p>{t("Release or replace this noncommercial block. Guest claims cannot be changed here.")}</p><form method="post" action="/api/access/admin/block/release"><ActionFields token={releaseToken}/><input name="blockId" type="hidden" value={c.block_id}/><input name="operationKey" type="hidden" value={randomUUID()}/><label>{t("Release reason")}<select name="reason"><option value="PLANS_CHANGED">{t("Plans changed")}</option><option value="WORK_COMPLETE">{t("Work complete")}</option><option value="CORRECTION">{t("Correct an entry")}</option></select></label><Confirm>{t('Reopen {unit} for the occupied nights shown above. Keep this block in history.',{unit:unitName(u.unit_key)})}</Confirm><button className="secondary">{t("Confirm release")}</button></form>
      <h3>{t("Replace block")}</h3><BlockForm units={v.units} token={replaceToken} operationKey={randomUUID()} blockId={c.block_id} initial={{unitId:c.unit_id,arrivalDate:c.arrival_date,departureDate:c.departure_date}}/></details>}</article>;
    }))}</div>:<p className="notice">{t("No active claims occupy this date range. Availability is checked again when a claim is created.")}</p>}</section>
    {createToken&&<section><h2>{t("Create an inventory block")}</h2><p>{t("Reserve nights for private use or an operational closure. Blocks do not create a guest, a payment, or revenue.")}</p><BlockForm units={v.units} token={createToken} operationKey={randomUUID()}/></section>}
    <section><h2>{t("Management history")}</h2>{history.length?<div className="table-wrap"><table><caption>{t("Latest 50 block actions in your accommodation scope")}</caption><thead><tr><th>{t("Action")}</th><th>{t("Accommodation")}</th><th>{t("Dates")}</th><th>{t("Actor reference")}</th><th>{t("Recorded")}</th></tr></thead><tbody>{history.map((a,i)=><tr key={i}><th scope="row">{a.action}{a.reason&&<small>{a.reason}</small>}</th><td>{unitName(a.unit_key)}</td><td>{day(a.arrival_date)} {t("to")} {day(a.departure_date)} {t("(exclusive)")}</td><td className="reference">{a.admin_user_id}</td><td>{instant(a.occurred_at)}</td></tr>)}</tbody></table></div>:<p>{t("No managed block actions have been recorded for these accommodations.")}</p>}</section>
    <section><h2>{t("Accommodation configuration")}</h2><div className="table-wrap"><table><caption>{t("Read-only configuration. Existing bookings and accepted prices remain authoritative.")}</caption><thead><tr><th>{t("Accommodation")}</th><th>{t("Capacity")}</th><th>{t("New quotes")}</th><th>{t("Configuration version")}</th></tr></thead><tbody>{v.units.map(u=><tr key={u.id}><th scope="row">{unitName(u.unit_key)}</th><td>{u.capacity}</td><td>{u.enabled?t("Enabled"):t("Disabled")}</td><td>{u.config_version}</td></tr>)}</tbody></table></div></section></>}
  </>;
}
