import type { Metadata } from 'next';
import { getPresentation } from '@/i18n/server';
import { LocaleProvider } from '@/i18n/client';
import './globals.css';
export async function generateMetadata():Promise<Metadata> {
  const {t}=await getPresentation();
  return {title:'Žemaitija Country Escapes',description:t('Fictional portfolio demonstration. No real accommodation or bookings are available.')};
}
export default async function RootLayout({children}:{children:React.ReactNode}) {
  const {locale}=await getPresentation();
  return <html lang={locale}><body><LocaleProvider key={locale} locale={locale}>{children}</LocaleProvider></body></html>;
}
