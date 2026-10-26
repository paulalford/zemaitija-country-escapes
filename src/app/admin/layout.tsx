import { getPresentation } from '@/i18n/server';
import { Shell } from '../workspace/ui';
import '../workspace/workspace.css';
export const dynamic='force-dynamic';
export async function generateMetadata(){const {t}=await getPresentation();return {title:`${t('Operator workspace')} — Žemaitija Country Escapes`,robots:{index:false,follow:false},referrer:'no-referrer' as const};}
export default function AdminLayout({children}:{children:React.ReactNode}){return <Shell admin>{children}</Shell>;}
