import { getPresentation } from '@/i18n/server';
import { publicMetadata } from '@/i18n/publication';
import { legalDraft, privacySections } from '@/i18n/content/legal';
import { PublicShell } from '../public-ui/shell';

export async function generateMetadata() { const {locale}=await getPresentation(); return publicMetadata(locale,'/privacy'); }
export default async function PolicyPage() {
  const {locale,t}=await getPresentation();
  const sections=privacySections.map(section=>({id:section.id,heading:section.heading[locale],body:section.body[locale]}));
  return <PublicShell><main id="content" tabIndex={-1} className="booking-main reading-main">
    <h1>{t('Privacy information')}</h1><p className="booking-notice">{legalDraft[locale]}</p>
    <nav className="reading-index" aria-label={t('Privacy information')}><ul>{sections.map(section=><li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ul></nav>
    {sections.map(section=><section className="quote-section" key={section.id} aria-labelledby={section.id}><h2 id={section.id}>{section.heading}</h2><p>{section.body}</p></section>)}
  </main></PublicShell>;
}
