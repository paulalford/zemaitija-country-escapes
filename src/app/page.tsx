import { getPresentation } from '@/i18n/server';
import { LanguageSwitcher } from '@/i18n/client';
import './workspace/workspace.css';
export default async function Home() {
  const {t}=await getPresentation();
  return <main><h1>Žemaitija Country Escapes</h1><p>{t('Fictional portfolio demonstration. No real accommodation or bookings are available.')}</p><LanguageSwitcher/></main>;
}
