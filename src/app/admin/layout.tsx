import { Shell } from '../workspace/ui';
import '../workspace/workspace.css';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default function AdminLayout({children}:{children:React.ReactNode}){return <Shell admin>{children}</Shell>;}
