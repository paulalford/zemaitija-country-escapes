import { getPresentation } from '@/i18n/server';
import { redirect } from 'next/navigation';
import { workspaceSession } from '../workspace/session';
import { Notice } from '../workspace/ui';
export default async function Admin({searchParams}:{searchParams:Promise<{notice?:string}>}){
  const {t,href}=await getPresentation();

  await workspaceSession('admin');const p=await searchParams;
  if(!p.notice)redirect(href('/admin/bookings'));
  return <><h1>{t("Operator workspace")}</h1><Notice code={p.notice}/><p>{t("Choose a workflow in the navigation to inspect its current state before retrying.")}</p></>;
}
