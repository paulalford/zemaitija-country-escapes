'use client';
import { usePresentation } from '@/i18n/client';
import '../public-ui/timber.css';
export default function CatalogError({reset}:{reset:()=>void}) {const {t}=usePresentation();return <main className="timber booking-main"><h1>{t('Stays')}</h1><p role="alert">{t('Catalog unavailable. Please try again later.')}</p><button onClick={reset}>{t('Try again')}</button></main>;}
