import { pool } from '@/db/client';
import { publicBookingRequest } from '@/server/public-booking-http';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}) {
  return publicBookingRequest(pool,request,(await params).action);
}
