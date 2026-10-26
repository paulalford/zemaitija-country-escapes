'use client';
import { usePresentation } from '@/i18n/client';
export default function Unavailable(){
  const {t}=usePresentation();
return <><h1>{t("Reservation unavailable")}</h1><p className="notice">{t("Sign in with an authorized identity and review your accommodation permissions before continuing.")}</p></>;}
