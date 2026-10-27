import { Arrow } from './arrow';
import { Suspense } from 'react';
import Image from 'next/image';
import { getPresentation } from '@/i18n/server';
import { LanguageSwitcher } from '@/i18n/client';
import type { PublicUnit } from '@/server/public-catalog';
import './timber.css';
export async function PublicShell({children}:{children:React.ReactNode}) {
  const {t,href}=await getPresentation();
  return <div className="timber"><a className="skip-link" href="#content">{t('Skip to content')}</a><header className="timber-header"><div className="header-inner"><a className="wordmark" href={href('/')} aria-label="Žemaitija Country Escapes"><span>Žemaitija</span><small>COUNTRY ESCAPES</small></a><nav className="main-nav" aria-label={t('Stays')}><a href={href('/')}>{t('Stays')}</a><a href={href('/accommodations')}>{t('Compare stays')}</a><a href={href('/explore')}>{t('Explore Žemaitija')}</a><a href={href('/experiences')}>{t('Experiences')}</a><a href={href('/manage/access')}>{t('Manage booking')}</a></nav><Suspense><LanguageSwitcher/></Suspense></div><p className="demo-band">{t('Fictional portfolio demo · No real bookings')}</p></header>{children}<footer className="timber-footer"><a href={href('/')}>Žemaitija Country Escapes</a><p>{t('Fictional portfolio demonstration. No real accommodation or bookings are available.')}</p><a href={href('/manage/access')}>{t('Manage booking')}</a></footer></div>;
}
export async function Illustration({unitKey='forest-cottage',priority=false}:{unitKey?:string;priority?:boolean}) {
  const {t}=await getPresentation();
  const file=unitKey==='lakeside-cabin'?'lakeside':unitKey==='family-cottage'?'family':'forest';
  return <figure className={`stay-image image-${file}`}><Image src={`/images/timber-index/${file}.webp`} width={1536} height={1024} sizes="(max-width: 760px) 100vw, 65vw" alt="" priority={priority}/><figcaption>{t('AI-generated regional illustration. No real property or facilities are depicted.')}</figcaption></figure>;
}
export async function StaySearch({units,selected}:{units:PublicUnit[];selected?:string}) {
  const {t,href,unitName}=await getPresentation();
  return <form className="stay-search" action={href('/booking')} method="get"><label>{t('Accommodation')}<select name="unit" required defaultValue={selected??''}><option value="" disabled>{t('Choose accommodation')}</option>{units.filter(u=>!selected||u.id===selected).map(u=><option value={u.id} key={u.id}>{unitName(u.unit_key)} · {t('Up to {capacity} guests',{capacity:u.capacity})}</option>)}</select></label><label>{t('Arrival')}<input type="date" name="arrival" required/></label><label>{t('Departure')}<input type="date" name="departure" required/></label><label>{t('Guests')}<input name="guests" type="number" min="1" max={selected?units.find(u=>u.id===selected)?.capacity:Math.max(...units.map(u=>u.capacity))} defaultValue="2" required/></label><button disabled={!units.length}>{t('Check availability')}<Arrow/></button></form>;
}
export { Arrow } from './arrow';
