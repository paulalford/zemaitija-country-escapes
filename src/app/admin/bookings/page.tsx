import { getPresentation } from '@/i18n/server';
import Link from 'next/link';
import { pool } from '@/db/client';
import { adminBookings } from '@/server/admin-management';
import { workspaceSession } from '../../workspace/session';
import { Status} from '../../workspace/ui';
export default async function Bookings(){
  const {t,day,money,unitName,href,statusLabel}=await getPresentation();

  const {raw,session}=await workspaceSession('admin'),rows=await adminBookings(pool,raw);
  return <><div className="page-heading"><div><h1>{t("Bookings")}</h1><p>{t('Reservations visible to your {role} role. All amounts are synthetic test data.',{role:statusLabel(session.role??'')})}</p></div><form method="post" action="/api/access/admin/logout"><button className="secondary">{t("Sign out")}</button></form></div>
    {rows.length?<div className="table-wrap"><table><caption>{t("Up to 100 most recent reservations by arrival")}</caption><thead><tr><th>{t("Accommodation")}</th><th>{t("Dates")}</th><th>{t("Status")}</th><th>{t("Accepted total")}</th><th>{t("Review")}</th></tr></thead><tbody>{rows.map(b=><tr key={b.id}><th scope="row">{unitName(b.unit_key)}</th><td>{day(b.arrival_date)} {t("to")} {day(b.departure_date)}</td><td><Status value={b.status}/></td><td>{money(b.total_cents)}</td><td><Link href={href(`/admin/bookings/${b.id}`)}>{t("Review reservation")}<span className="sr-only"> {b.id}</span></Link></td></tr>)}</tbody></table></div>:<p className="notice">{t("No accepted reservations are visible. An operations identity needs accommodation permissions before bookings appear.")}</p>}</>;
}
