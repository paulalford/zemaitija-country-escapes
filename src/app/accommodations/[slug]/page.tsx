import { notFound } from 'next/navigation';
import { pool } from '@/db/client';
import { publicCatalog, publicUnitKeys } from '@/server/public-catalog';
import { getPresentation } from '@/i18n/server';
import { PublicShell, Illustration, StaySearch, Arrow } from '../../public-ui/shell';
export default async function Accommodation({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  if(!publicUnitKeys.some(k=>k===slug))notFound();
  const {t,href,unitName}=await getPresentation();
  // A catalog outage remains a service failure rather than fabricated property data.
  const units=await publicCatalog(pool),unit=units.find(u=>u.unit_key===slug);
  if(!unit)notFound();
  return <PublicShell><main id="content"><div className="detail-heading"><a className="text-link" href={href('/accommodations')}>{t('All stays')}</a><h1>{unitName(unit.unit_key)}</h1><p className="capacity">{t('Up to {capacity} guests',{capacity:unit.capacity})}</p><a className="text-link" href="#availability">{t('Check dates')}<Arrow/></a></div><div className="detail-illustration"><Illustration unitKey={unit.unit_key} priority/></div><section className="detail-content" id="availability"><h2>{t('Check dates')}</h2><p>{t('A fictional stay inspired by rural Žemaitija.')}</p><StaySearch units={units} selected={unit.id}/><p>{t('Availability is advisory. Dates are reserved only after server acceptance.')}</p><div className="detail-facts"><h2>{t('Good to know')}</h2><p>{t('Facilities, sleeping arrangements, accessibility and stay rules are not specified. Images establish none of these facts.')}</p>{slug==='lakeside-cabin'&&<p>{t('The name does not establish lake access or waterfront location.')}</p>}<p>{t('Price depends on dates. Only a server quote establishes the provisional demo price.')}</p><p>{t('Departure date is not an occupied night')}</p></div></section></main></PublicShell>;
}
