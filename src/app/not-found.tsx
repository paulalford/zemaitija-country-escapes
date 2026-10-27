import { getPresentation } from '@/i18n/server';
import { PublicShell } from './public-ui/shell';
export default async function NotFound() {const {t,href}=await getPresentation();return <PublicShell><main className="booking-main" id="content"><h1>{t('Page not found')}</h1><a className="text-link" href={href('/accommodations')}>{t('All stays')}</a></main></PublicShell>;}
