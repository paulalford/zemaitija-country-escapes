import Link from 'next/link';
import { pool } from '@/db/client';
import { adminIncidents } from '@/server/admin-management';
import { workspaceSession } from '../../workspace/session';
import { Status, instant, money } from '../../workspace/ui';
export default async function Incidents(){
  const {raw,session}=await workspaceSession('admin'),v=await adminIncidents(pool,raw);
  return <><h1>Operational review</h1><p>Unresolved test-payment incidents and notification delivery failures. Investigation does not authorize a financial correction.</p>
    <section><h2>Payment incidents</h2>{session.role==='operations'?<p>Detailed financial investigation requires finance or administrator access.</p>:v.incidents.length?<div className="table-wrap"><table><caption>Up to 100 open financial incidents</caption><thead><tr><th>Kind</th><th>State</th><th>Observed amount</th><th>Opened</th></tr></thead><tbody>{v.incidents.map(r=><tr key={r.id}><th scope="row">{r.kind}</th><td><Status value={r.state}/></td><td>{r.observed_cents===null?'Unknown':money(r.observed_cents)}</td><td>{instant(r.opened_at)}</td></tr>)}</tbody></table></div>:<p className="notice">No open financial incidents are recorded.</p>}</section>
    <section><h2>Notification delivery</h2>{v.notices.length?<div className="table-wrap"><table><caption>Up to 100 failed or waiting sandbox notices in your scope</caption><thead><tr><th>Notice</th><th>State</th><th>Due</th><th>Reservation</th></tr></thead><tbody>{v.notices.map(n=><tr key={n.id}><th scope="row">{n.event_type}</th><td><Status value={n.state}/></td><td>{instant(n.due_at)}</td><td>{n.booking_id?<Link href={`/admin/bookings/${n.booking_id}`}>Review reservation</Link>:'Financial incident'}</td></tr>)}</tbody></table></div>:<p className="notice">No failed or waiting sandbox notices are visible in your scope.</p>}</section></>;
}
