import Image from 'next/image';
import { getPresentation } from '@/i18n/server';
import { findDestination } from '@/content/destinations';
import { Arrow } from '../public-ui/arrow';

export async function DestinationPhoto({ kind }: { kind: 'lake' | 'crosses' }) {
  const { t } = await getPresentation();
  const lake = kind === 'lake';
  const source = lake ? 'https://commons.wikimedia.org/wiki/File:Plateli%C5%B3_e%C5%BEero_ap%C5%BEvalgos_aik%C5%A1tel%C4%97,_Plateliai,_Litva_02.jpg' : 'https://commons.wikimedia.org/wiki/File:Hill_of_Crosses_-_Lithuania.jpg';
  return <figure className={`destination-photo destination-photo-${kind}`}><Image src={lake ? '/images/destinations/plateliai-viewpoint.jpg' : '/images/destinations/hill-of-crosses.jpg'} width={lake ? 1280 : 960} height={lake ? 961 : 1440} sizes="(max-width: 760px) 100vw, 65vw" alt={t(lake ? 'Lake photo alt' : 'Crosses photo alt')} priority={lake}/><figcaption>{lake ? 'Plateliai · Fry72 / Karel Frydrýšek' : 'Kryžių kalnas · Ben Meyer'} · <a href={source}>{t('Photograph and licence')}</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. {t('Responsive crop')}</figcaption></figure>;
}

export async function HillOfCrossesFeature() {
  const { locale, t } = await getPresentation();
  const hill = findDestination('E01')!;
  return <section className="hill-feature" aria-labelledby="hill-title"><div className="hill-copy"><h2 id="hill-title">{hill.name[locale]}</h2><p className="excursion-qualifier">{t('Major excursion · Šiauliai District')}</p><h3>{t('A place of faith and remembrance.')}</h3><p>{hill.description[locale]}</p><a className="text-link" href={hill.source} aria-label={t('Official visitor information for {name}', { name: hill.name[locale] })}><span>{t('Official visitor information')}</span><Arrow/></a></div><DestinationPhoto kind="crosses"/></section>;
}

export async function StayReturn() {
  const { t, href } = await getPresentation();
  return <section className="destination-stay-return"><h2>{t('Return to a countryside stay.')}</h2><div><a className="text-link" href={href('/accommodations')}>{t('Compare stays')}<Arrow/></a><a className="button" href={href('/booking')}>{t('Check availability')}<Arrow/></a></div></section>;
}
