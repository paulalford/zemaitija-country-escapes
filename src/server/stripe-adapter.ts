import 'server-only';
import Stripe from 'stripe';
import { z } from 'zod';

export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;
const configSchema = z.object({
  STRIPE_SECRET_KEY: z.string().startsWith('sk_test_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_ACCOUNT_ID: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  STRIPE_SUCCESS_URL: z.url(),
  STRIPE_CANCEL_URL: z.url(),
});
export type StripeConfig = z.infer<typeof configSchema>;
export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const config = configSchema.parse(env);
  for (const url of [config.STRIPE_SUCCESS_URL, config.STRIPE_CANCEL_URL]) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('Stripe return URLs require HTTPS or local HTTP');
    }
  }
  return config;
}

export type Correlation = { bookingId: string; holdId?: string; attemptId: string; commandId: string };
export type CheckoutPaymentPurpose = 'INITIAL_ADVANCE' | 'INITIAL_FULL' | 'BALANCE';
export type CheckoutRequest = {
  correlation: Correlation; amountCents: number; expiresAt: number; successUrl: string; cancelUrl: string; idempotencyKey: string;
  /** Absent only on legacy durable requests: preserve their original Stripe parameters on replay. */
  paymentPurpose?: CheckoutPaymentPurpose;
};
export type CheckoutSession = {
  id: string; accountId: string; url: string | null; created: number; expiresAt: number; status: string;
  paymentStatus: string; paymentIntentId: string | null; amountTotal: number | null;
  currency: string | null; livemode: boolean; mode: string; paymentMethodTypes: string[];
  clientReferenceId: string | null;
  metadata: Record<string,string>;
};
export type PaymentEvidence = {
  id: string; status: string; amountReceived: number; currency: string; livemode: boolean;
  metadata: Record<string,string>; chargeId: string | null; chargePaid: boolean;
  chargeCaptured: boolean; chargeAmount: number | null; chargeCurrency: string | null;
  /** Stripe Charge creation instant; nullable when authoritative timing is unavailable. */
  chargeCreated?: number | null;
};
export type VerifiedEvent = { id: string; type: string; created: number; livemode: boolean; accountId: string; objectType: string; objectId: string };
export interface StripeGateway {
  readonly accountId: string;
  createSession(request: CheckoutRequest): Promise<CheckoutSession>;
  retrieveSession(id: string): Promise<CheckoutSession>;
  findSessionForPaymentIntent(id: string): Promise<CheckoutSession | null>;
  retrievePaymentIntent(id: string): Promise<PaymentEvidence>;
  expireSession(id: string, idempotencyKey: string): Promise<CheckoutSession>;
  verifyEvent(raw: Buffer, signature: string): VerifiedEvent;
}

function normalizeSession(s: Stripe.Checkout.Session, accountId: string): CheckoutSession {
  return { id:s.id,accountId,url:s.url,created:s.created,expiresAt:s.expires_at,status:s.status ?? 'unknown',
    paymentStatus:s.payment_status,paymentIntentId:typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null,
    amountTotal:s.amount_total,currency:s.currency,livemode:s.livemode,mode:s.mode,
    paymentMethodTypes:s.payment_method_types,clientReferenceId:s.client_reference_id,
    metadata:s.metadata ?? {} };
}

export class StripeSdkGateway implements StripeGateway {
  readonly accountId: string;
  private readonly stripe: Stripe;
  private accountCheck?: Promise<void>;
  constructor(private readonly config: StripeConfig) {
    this.accountId=config.STRIPE_ACCOUNT_ID;
    this.stripe=new Stripe(config.STRIPE_SECRET_KEY,{apiVersion:STRIPE_API_VERSION,maxNetworkRetries:0,timeout:10_000});
  }
  private async assertAccount() {
    this.accountCheck ??= this.stripe.accounts.retrieve(null).then(account => {
      if (account.id !== this.accountId) throw new Error('Stripe test account mismatch');
    });
    await this.accountCheck;
  }
  async createSession(request: CheckoutRequest): Promise<CheckoutSession> {
    await this.assertAccount();
    const c=request.correlation;
    const descriptions:Record<CheckoutPaymentPurpose,string>={
      INITIAL_ADVANCE:'Synthetic accommodation booking advance',
      INITIAL_FULL:'Synthetic accommodation booking full initial payment',
      BALANCE:'Synthetic accommodation booking balance',
    };
    const session=await this.stripe.checkout.sessions.create({
      mode:'payment',payment_method_types:['card'],client_reference_id:c.bookingId,
      success_url:request.successUrl,cancel_url:request.cancelUrl,expires_at:request.expiresAt,
      allow_promotion_codes:false,automatic_tax:{enabled:false},
      line_items:[{price_data:{currency:'eur',unit_amount:request.amountCents,
        product_data:{name:descriptions[request.paymentPurpose??'INITIAL_ADVANCE']}},quantity:1}],
      metadata:{bookingId:c.bookingId,...(c.holdId?{holdId:c.holdId}:{}),attemptId:c.attemptId,commandId:c.commandId},
      payment_intent_data:{metadata:{bookingId:c.bookingId,...(c.holdId?{holdId:c.holdId}:{}),attemptId:c.attemptId,commandId:c.commandId}},
    },{idempotencyKey:request.idempotencyKey});
    if (session.livemode) throw new Error('Live Stripe Session rejected');
    return normalizeSession(session,this.accountId);
  }
  async retrieveSession(id: string): Promise<CheckoutSession> {
    await this.assertAccount();
    const session=await this.stripe.checkout.sessions.retrieve(id);
    if (session.livemode) throw new Error('Live Stripe Session rejected');
    return normalizeSession(session,this.accountId);
  }
  async findSessionForPaymentIntent(id: string): Promise<CheckoutSession | null> {
    await this.assertAccount();
    const matches=await this.stripe.checkout.sessions.list({payment_intent:id,limit:2});
    if (matches.data.length>1) throw new Error('PaymentIntent has ambiguous Checkout Sessions');
    if (!matches.data[0]) return null;
    return this.retrieveSession(matches.data[0].id);
  }
  async retrievePaymentIntent(id: string): Promise<PaymentEvidence> {
    await this.assertAccount();
    const intent=await this.stripe.paymentIntents.retrieve(id,{expand:['latest_charge']});
    if (intent.livemode) throw new Error('Live Stripe PaymentIntent rejected');
    let charge: Stripe.Charge | null=null;
    if (typeof intent.latest_charge === 'string') charge=await this.stripe.charges.retrieve(intent.latest_charge);
    else if (intent.latest_charge && !('deleted' in intent.latest_charge)) charge=intent.latest_charge;
    return {id:intent.id,status:intent.status,amountReceived:intent.amount_received,currency:intent.currency,
      livemode:intent.livemode,metadata:intent.metadata ?? {},chargeId:charge?.id ?? null,
      chargePaid:charge?.paid === true,chargeCaptured:charge?.captured === true,
      chargeAmount:charge?.amount ?? null,chargeCurrency:charge?.currency ?? null,
      chargeCreated:charge?.created ?? null};
  }
  async expireSession(id: string, idempotencyKey: string): Promise<CheckoutSession> {
    await this.assertAccount();
    const session=await this.stripe.checkout.sessions.expire(id,{}, {idempotencyKey});
    if (session.livemode) throw new Error('Live Stripe Session rejected');
    return normalizeSession(session,this.accountId);
  }
  verifyEvent(raw: Buffer, signature: string): VerifiedEvent {
    const event=this.stripe.webhooks.constructEvent(raw,signature,this.config.STRIPE_WEBHOOK_SECRET);
    if (event.livemode || (event.account && event.account!==this.accountId)) throw new Error('Wrong Stripe environment or account');
    const object=event.data.object as {object?:string;id?:string};
    if (!object.id || !object.object) throw new Error('Webhook object identity missing');
    return {id:event.id,type:event.type,created:event.created,livemode:event.livemode,
      accountId:event.account ?? this.accountId,objectType:object.object,objectId:object.id};
  }
}

export function stripeGateway(env: NodeJS.ProcessEnv = process.env): StripeGateway {
  return new StripeSdkGateway(stripeConfig(env));
}
