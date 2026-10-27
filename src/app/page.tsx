import { pool } from '@/db/client';
import { publicCatalog } from '@/server/public-catalog';
import { getPresentation } from '@/i18n/server';
import { PublicShell, Illustration, StaySearch, Arrow } from './public-ui/shell';
export default async function Home() {
  const {t,href,unitName}=await getPresentation();
  const units=await publicCatalog(pool).catch(()=>[]);
  return <PublicShell><main id="content"><section className="timber-hero"><div className="stay-index"><div className="index-intro"><h1>{t('Three stays. Your own pace.')}</h1><a className="early-booking" href="#availability">{t('Check availability')}<Arrow/></a></div>{units.map(u=><a className="index-row" href={href(`/accommodations/${u.unit_key}`)} key={u.id}><span><strong>{unitName(u.unit_key)}</strong><span>{t('Up to {capacity} guests',{capacity:u.capacity})}</span></span><Arrow/></a>)}{!units.length&&<p className="index-intro">{t('Catalog unavailable. Please try again later.')}</p>}</div><div className="hero-illustration"><Illustration priority/></div><div className="hero-search" id="availability"><StaySearch units={units}/></div></section><section className="editorial-feature"><div><h2>{t('A fictional stay inspired by rural Žemaitija.')}</h2><p>{t('Facilities, sleeping arrangements, accessibility and stay rules are not specified. Images establish none of these facts.')}</p><a className="text-link" href={href('/accommodations')}>{t('Compare stays')}<Arrow/></a></div><Illustration unitKey="family-cottage"/></section></main></PublicShell>;
}
