import { pool } from '@/db/client';
import { stripeGateway } from '@/server/stripe-adapter';
import { ingestStripeWebhook, WebhookInputError } from '@/server/stripe-webhooks';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const maxBytes=1024*1024;

async function boundedBody(request:Request):Promise<Buffer> {
  const length=Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length>maxBytes) throw new WebhookInputError('Webhook body too large');
  const reader=request.body?.getReader();
  if (!reader) throw new WebhookInputError('Webhook body missing');
  const chunks:Buffer[]=[];
  let size=0;
  while (true) {
    const part=await reader.read();
    if (part.done) break;
    size+=part.value.byteLength;
    if (size>maxBytes) { await reader.cancel(); throw new WebhookInputError('Webhook body too large'); }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks,size);
}

export async function POST(request:Request):Promise<Response> {
  try {
    const raw=await boundedBody(request);
    const signature=request.headers.get('stripe-signature')??'';
    await ingestStripeWebhook(pool,stripeGateway(),raw,signature);
    return new Response(null,{status:200});
  } catch (error) {
    if (error instanceof WebhookInputError) return new Response(null,{status:400});
    return new Response(null,{status:503});
  }
}
