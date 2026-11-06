import { getPresentation } from '@/i18n/server';
import { publicMetadata } from '@/i18n/publication';
import { legalDraft, termsSections } from '@/i18n/content/legal';
import { PublicShell } from '../public-ui/shell';

export async function generateMetadata() { const {locale}=await getPresentation(); return publicMetadata(locale,'/terms'); }
export default async function PolicyPage() {
  const {locale,t}=await getPresentation();
  const sections=termsSections(locale);
  return <PublicShell><main id="content" tabIndex={-1} className="booking-main reading-main">
    <h1>{t('Demonstration terms')}</h1><p className="booking-notice">{legalDraft[locale]}</p>
    <nav className="reading-index" aria-label={t('Demonstration terms')}><ul>{sections.map(section=><li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ul></nav>
    {sections.map(section=><section className="quote-section" key={section.id} aria-labelledby={section.id}><h2 id={section.id}>{section.heading}</h2><p>{section.body}</p></section>)}
  </main></PublicShell>;
}
