'use client';
import { usePresentation } from '@/i18n/client';
export default function Loading(){
  const {t}=usePresentation();
return <div role="status"><h1>{t("Loading reservation")}</h1><p>{t("Retrieving the latest booking and verified payment position…")}</p></div>;}
