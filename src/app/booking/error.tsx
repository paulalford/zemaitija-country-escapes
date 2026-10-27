'use client';
import { usePresentation } from '@/i18n/client';
import '../public-ui/timber.css';
export default function ErrorPage({reset}:{reset:()=>void}) {const {t}=usePresentation();return <main className="timber booking-main"><h1>{t('Your demo stay')}</h1><p role="alert">{t('The request could not finish. Retry the same action to inspect or resume it; do not start another booking.')}</p><button onClick={reset}>{t('Refresh recorded status')}</button></main>;}
