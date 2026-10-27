import { getPresentation } from '@/i18n/server';
import { destinations, findDestination } from '@/content/destinations';
import { PublicShell, Arrow } from '../public-ui/shell';
import { DestinationAtlas } from './destination-atlas';
import { DestinationPhoto, HillOfCrossesFeature, StayReturn } from './destination-ui';
import './destinations.css';

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, t, href } = await getPresentation();
  const query = await searchParams;
  const initial = findDestination(typeof query.destination === 'string' ? query.destination : undefined);
  return <PublicShell><main id="content" className="destination-main">
    <section className="landscape-opening"><div className="landscape-intro"><h1>{t('Explore Žemaitija')}</h1><h2>{t('Lakes, forests and the places between.')}</h2><p>{t('Landscape introduction')}</p><a className="button" href={href('/booking')}>{t('Check availability')}<Arrow/></a></div><DestinationPhoto kind="lake"/></section>
    <p className="destination-disclaimer">{t('Independent destinations')}</p>
    <DestinationAtlas initialId={initial?.id}/>
    <HillOfCrossesFeature/>
    <section className="wider-discovery"><div><h2>{t('Across Žemaitija')}</h2><p>{t('Check before visiting')}</p></div><div className="wider-index">{destinations.filter(d => ['R01', 'R03', 'R04', 'R05'].includes(d.id)).map(d => <a href={`${href(`/experiences?destination=${d.id}`)}#destination-${d.id}`} key={d.id}><span>{d.name[locale]}<small>{d.area[locale]}</small></span><Arrow/></a>)}<a href={href('/experiences')}><strong>{t('More destinations')}</strong><Arrow/></a></div></section>
    <StayReturn/>
  </main></PublicShell>;
}
