import Link from 'next/link';
import { pool } from '@/db/client';
import { adminBookings } from '@/server/admin-management';
import { workspaceSession } from '../../workspace/session';
import { Status, day, money, unitName } from '../../workspace/ui';
export default async function Bookings(){
  const {raw,session}=await workspaceSession('admin'),rows=await adminBookings(pool,raw);
  return <><div className="page-heading"><div><h1>Bookings</h1><p>Reservations visible to your {session.role} role. All amounts are synthetic test data.</p></div><form method="post" action="/api/access/admin/logout"><button className="secondary">Sign out</button></form></div>
    {rows.length?<div className="table-wrap"><table><caption>Up to 100 most recent reservations by arrival</caption><thead><tr><th>Accommodation</th><th>Dates</th><th>Status</th><th>Accepted total</th><th>Review</th></tr></thead><tbody>{rows.map(b=><tr key={b.id}><th scope="row">{unitName(b.unit_key)}</th><td>{day(b.arrival_date)} to {day(b.departure_date)}</td><td><Status value={b.status}/></td><td>{money(b.total_cents)}</td><td><Link href={`/admin/bookings/${b.id}`}>Review reservation<span className="sr-only"> {b.id}</span></Link></td></tr>)}</tbody></table></div>:<p className="notice">No accepted reservations are visible. An operations identity needs accommodation permissions before bookings appear.</p>}</>;
}
