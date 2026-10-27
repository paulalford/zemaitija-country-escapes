import { getPresentation } from '@/i18n/server';
import { destinations, destinationGroups, destinationMarkers, findDestination, type DestinationCategory, type DestinationGroup } from '@/content/destinations';
import { PublicShell, Arrow } from '../public-ui/shell';
import { DestinationAtlas } from '../explore/destination-atlas';
import { StayReturn } from '../explore/destination-ui';
import { categoryLabels, groupLabels } from '../explore/destination-labels';
import '../explore/destinations.css';

export default async function ExperiencesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, t, href } = await getPresentation();
  const query = await searchParams;
  const area = typeof query.area === 'string' && destinationGroups.includes(query.area as DestinationGroup) ? query.area as DestinationGroup : undefined;
  const interest = typeof query.interest === 'string' && Object.hasOwn(categoryLabels, query.interest) ? query.interest as DestinationCategory : undefined;
  const initial = findDestination(typeof query.destination === 'string' ? query.destination : undefined);
  const visible = destinations.filter(d => (!area || d.group === area) && (!interest || d.category === interest));
  return <PublicShell><main id="content" className="destination-main">
    <header className="experiences-heading"><div><h1>{t('Experiences')}</h1><h2>{t('Plan your discoveries')}</h2><p>{t('Directory introduction')}</p></div><a className="button" href={href('/booking')}>{t('Check availability')}<Arrow/></a></header>
    <p className="destination-disclaimer">{t('Independent destinations')}</p>
    <form className="destination-filters" method="get" action={href('/experiences')}><label>{t('Area')}<select name="area" defaultValue={area ?? ''}><option value="">{t('All areas')}</option>{destinationGroups.map(group => <option key={group} value={group}>{t(groupLabels[group])}</option>)}</select></label><label>{t('Interest')}<select name="interest" defaultValue={interest ?? ''}><option value="">{t('All interests')}</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label><button>{t('Apply filters')}</button><a href={href('/experiences')}>{t('Reset filters')}</a></form>
    <nav className="geographic-index" aria-label={t('Area')}>{destinationGroups.filter(group => visible.some(d => d.group === group)).map(group => <a href={`#area-${group}`} key={group}>{t(groupLabels[group])}<Arrow/></a>)}</nav>
    <div className="destination-directory">{!visible.length && <p role="status">{t('No matching destinations')}</p>}{destinationGroups.map(group => {
      const entries = visible.filter(d => d.group === group);
      return entries.length ? <section className="directory-group" key={group} id={`area-${group}`}><h2>{t(groupLabels[group])}</h2><div>{entries.map(destination => <article className={`destination-entry${destination.id === 'E01' ? ' directory-hill' : ''}`} id={`destination-${destination.id}`} key={destination.id}>
        <div><h3>{destination.name[locale]}</h3><p className={destination.id === 'E01' ? 'excursion-qualifier' : 'destination-area'}>{destination.id === 'E01' ? t('Major excursion · Šiauliai District') : destination.area[locale]}</p><p className="destination-category">{t(categoryLabels[destination.category])}</p></div>
        <div><p>{destination.description[locale]}</p><a href={destination.source} aria-label={t('Official visitor information for {name}', { name: destination.name[locale] })}>{t('Official visitor information')}</a>{!destinationMarkers.some(marker => marker.destinationId === destination.id) && <p className="no-map-point">{t('No map point')}</p>}</div>
      </article>)}</div></section> : null;
    })}</div>
    <DestinationAtlas initialId={initial?.id}/><p className="destination-disclaimer">{t('Check before visiting')}</p>
    <StayReturn/>
  </main></PublicShell>;
}
