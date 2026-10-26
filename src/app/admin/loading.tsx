'use client';
import { usePresentation } from '@/i18n/client';
export default function Loading(){
  const {t}=usePresentation();
return <div role="status"><h1>{t("Loading workspace")}</h1><p>{t("Checking access and retrieving current records…")}</p></div>;}
