import { getPresentation } from '@/i18n/server';
import { randomUUID } from 'node:crypto';
import { pool } from '@/db/client';
import { adminIdentities } from '@/server/admin-management';
import { AccessDenied, mintAction } from '@/server/access';
import { workspaceSession } from '../../workspace/session';
import { ActionFields, Confirm, Notice } from '../../workspace/ui';
export default async function Identities({searchParams}:{searchParams:Promise<{notice?:string}>}) {
  const {t,statusLabel}=await getPresentation();

  const {raw}=await workspaceSession('admin');let identities;
  try{identities=await adminIdentities(pool,raw);}catch(e){if(e instanceof AccessDenied)return <><h1>{t("Administrator identities")}</h1><p className="notice">{t("Identity management requires the administrator role.")}</p></>;throw e;}
  return <><Notice code={(await searchParams).notice}/><h1>{t("Administrator identities")}</h1><p>{t("Only independently provisioned identities can sign in. Changes revoke the affected sessions. You cannot change your own identity here.")}</p>
    <div className="table-wrap"><table><caption>{t("Up to 100 identities, most recent first")}</caption><thead><tr><th>{t("Identity reference")}</th><th>{t("Verified issuer and subject mapping")}</th><th>{t("Role")}</th><th>{t("Enabled")}</th></tr></thead><tbody>{identities.map(a=><tr key={a.id}><th className="reference" scope="row">{a.id}</th><td className="reference">{a.external_subject}</td><td>{statusLabel(a.role)}</td><td>{a.enabled?t("Yes"):t("No")}</td></tr>)}</tbody></table></div>
    <section><h2>{t("Provision or update an identity")}</h2><p>{t("Fresh MFA within ten minutes is required. Copy the exact issuer and stable subject from the trusted identity provider. Operations users see only explicitly assigned accommodation IDs.")}</p><form method="post" action="/api/access/admin/identity"><ActionFields token={await mintAction(pool,raw,'admin','admin/identity')}/><input name="operationKey" type="hidden" value={randomUUID()}/>
      <label>{t("Existing identity ID (leave empty to provision)")}<input name="id" autoComplete="off"/></label><label>{t("Issuer|subject mapping")}<input name="subject" placeholder="https://identity.example.test|stable-subject" required maxLength={500}/></label>
      <div className="form-grid"><label>{t("Role")}<select name="role"><option value="operations">{t("Operations")}</option><option value="finance">{t("Finance")}</option><option value="administrator">{t("Administrator")}</option></select></label><label>{t("Access")}<select name="enabled"><option value="true">{t("Enabled")}</option><option value="false">{t("Disabled")}</option></select></label></div>
      <label>{t("Permitted accommodation IDs (comma separated)")}<input name="unitIds" autoComplete="off"/></label><label>{t("Review reason")}<input name="reason" required minLength={3} maxLength={500}/></label><Confirm>{t("I independently verified the identity, role and unit permissions and authorize this access change.")}</Confirm><button className="danger">{t("Confirm identity change")}</button></form></section></>;
}
