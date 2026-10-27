import { pool } from '@/db/client';
import { publicCatalog } from '@/server/public-catalog';
import { getPresentation } from '@/i18n/server';
import { PublicShell, Illustration, Arrow } from '../public-ui/shell';
export default async function Accommodations() {
  const {t,href,unitName}=await getPresentation();
  const units=await publicCatalog(pool).catch(()=>[]);
  return <PublicShell><main id="content"><div className="page-intro dark-intro"><h1>{t('Compare stays')}</h1><p>{t('Three stays. Your own pace.')}</p></div><div className="stay-comparison">{units.map(u=><article className="comparison-row" key={u.id}><Illustration unitKey={u.unit_key}/><div className="comparison-copy"><h2><a href={href(`/accommodations/${u.unit_key}`)}>{unitName(u.unit_key)}</a></h2><p className="capacity">{t('Up to {capacity} guests',{capacity:u.capacity})}</p><p>{t('Facilities, sleeping arrangements, accessibility and stay rules are not specified. Images establish none of these facts.')}</p><p>{t('Price depends on dates. Only a server quote establishes the provisional demo price.')}</p><div className="comparison-actions"><a className="button" href={href(`/booking?unit=${u.id}`)}>{t('Check dates')}<Arrow/></a><a className="button secondary" href={href(`/accommodations/${u.unit_key}`)}>{t('Explore stay')}<Arrow/></a></div></div></article>)}{!units.length&&<p>{t('Catalog unavailable. Please try again later.')}</p>}</div></main></PublicShell>;
}
