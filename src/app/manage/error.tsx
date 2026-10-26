'use client';
import { usePresentation } from '@/i18n/client';
import Link from 'next/link';
export default function Error({reset}:{reset:()=>void}){
  const {t,href}=usePresentation();
return <><h1>{t("Reservation unavailable")}</h1><p className="notice" role="alert">{t("Your session may have expired, or the service could not retrieve the latest records. Refresh before retrying any action.")}</p><button onClick={reset}>{t("Try again")}</button><p><Link href={href('/manage/access')}>{t("Open a fresh access link")}</Link></p></>;}
