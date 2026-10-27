import { pool } from '@/db/client';
import { publicCatalog } from '@/server/public-catalog';
import { PublicShell } from '../public-ui/shell';
import { BookingFlow } from './stay-form';
export default async function Booking({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const initial=await searchParams,units=await publicCatalog(pool).catch(()=>[]);
  return <PublicShell><main id="content" className="booking-main"><BookingFlow units={units} initial={{unit:typeof initial.unit==='string'?initial.unit:'',arrival:typeof initial.arrival==='string'?initial.arrival:'',departure:typeof initial.departure==='string'?initial.departure:'',guests:typeof initial.guests==='string'?initial.guests:'2'}}/></main></PublicShell>;
}
