import { getPresentation } from '@/i18n/server';
import Link from 'next/link';
import { pool } from '@/db/client';
import { adminIncidents } from '@/server/admin-management';
import { workspaceSession } from '../../workspace/session';
import { Status} from '../../workspace/ui';
export default async function Incidents(){
  const {t,instant,money,href,statusLabel}=await getPresentation();

  const {raw,session}=await workspaceSession('admin'),v=await adminIncidents(pool,raw);
  return <><h1>{t("Operational review")}</h1><p>{t("Unresolved test-payment incidents and notification delivery failures. Investigation does not authorize a financial correction.")}</p>
    <section><h2>{t("Payment incidents")}</h2>{session.role==='operations'?<p>{t("Detailed financial investigation requires finance or administrator access.")}</p>:v.incidents.length?<div className="table-wrap"><table><caption>{t("Up to 100 open financial incidents")}</caption><thead><tr><th>{t("Kind")}</th><th>{t("State")}</th><th>{t("Observed amount")}</th><th>{t("Opened")}</th></tr></thead><tbody>{v.incidents.map(r=><tr key={r.id}><th scope="row">{statusLabel(r.kind)}</th><td><Status value={r.state}/></td><td>{r.observed_cents===null?t("Unknown"):money(r.observed_cents)}</td><td>{instant(r.opened_at)}</td></tr>)}</tbody></table></div>:<p className="notice">{t("No open financial incidents are recorded.")}</p>}</section>
    <section><h2>{t("Notification delivery")}</h2>{v.notices.length?<div className="table-wrap"><table><caption>{t("Up to 100 failed or waiting sandbox notices in your scope")}</caption><thead><tr><th>{t("Notice")}</th><th>{t("State")}</th><th>{t("Due")}</th><th>{t("Reservation")}</th></tr></thead><tbody>{v.notices.map(n=><tr key={n.id}><th scope="row">{statusLabel(n.event_type)}</th><td><Status value={n.state}/></td><td>{instant(n.due_at)}</td><td>{n.booking_id?<Link href={href(`/admin/bookings/${n.booking_id}`)}>{t("Review reservation")}</Link>:t("Financial incident")}</td></tr>)}</tbody></table></div>:<p className="notice">{t("No failed or waiting sandbox notices are visible in your scope.")}</p>}</section></>;
}
