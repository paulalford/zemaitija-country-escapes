'use client';
import { usePresentation } from '@/i18n/client';
import Link from 'next/link';
export default function Error({reset}:{reset:()=>void}){
  const {t,href}=usePresentation();
return <><h1>{t("Workspace unavailable")}</h1><p className="notice" role="alert">{t("Access may have changed, or the service could not retrieve current records. Refresh before retrying any action.")}</p><button onClick={reset}>{t("Try again")}</button><p><Link href={href('/admin/signin')}>{t("Sign in again")}</Link></p></>;}
