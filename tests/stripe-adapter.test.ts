import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STRIPE_API_VERSION, StripeSdkGateway, type CheckoutRequest } from '../src/server/stripe-adapter';

const sdk=vi.hoisted(()=>({
  create:vi.fn<(params:Stripe.Checkout.SessionCreateParams,options:Stripe.RequestOptions)=>Promise<Partial<Stripe.Checkout.Session>>>(),
  account:vi.fn<()=>Promise<{id:string}>>(),
  constructor:vi.fn(),
}));
vi.mock('stripe',()=>({default:class {
  constructor(secret:string,options:unknown) { sdk.constructor(secret,options); }
  accounts={retrieve:sdk.account};
  checkout={sessions:{create:sdk.create}};
}}));

const config={STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',
  STRIPE_ACCOUNT_ID:'acct_test_fixture',STRIPE_SUCCESS_URL:'http://localhost:3000/return',
  STRIPE_CANCEL_URL:'http://localhost:3000/cancel'};
const correlation={bookingId:'booking-fixture',holdId:'hold-fixture',attemptId:'attempt-fixture',commandId:'command-fixture'};
const base:CheckoutRequest={correlation,amountCents:12345,expiresAt:1_800_000_000,
  successUrl:config.STRIPE_SUCCESS_URL,cancelUrl:config.STRIPE_CANCEL_URL,idempotencyKey:'stable-fixture-key'};

beforeEach(()=>{
  vi.clearAllMocks();
  sdk.account.mockResolvedValue({id:config.STRIPE_ACCOUNT_ID});
  sdk.create.mockResolvedValue({id:'cs_test_fixture',livemode:false});
});

describe('Stripe Checkout request parameters',()=>{
  it.each([
    ['INITIAL_ADVANCE','Synthetic accommodation booking advance',true],
    ['INITIAL_FULL','Synthetic accommodation booking full initial payment',true],
    ['BALANCE','Synthetic accommodation booking balance',false],
  ] as const)('describes %s while preserving exact payment and security parameters',async(paymentPurpose,name,hasHold)=>{
    const metadata=hasHold?correlation:{bookingId:correlation.bookingId,attemptId:correlation.attemptId,commandId:correlation.commandId};
    const gateway=new StripeSdkGateway(config);
    await gateway.createSession({...base,correlation:metadata,paymentPurpose});
    expect(sdk.constructor).toHaveBeenCalledWith('sk_test_synthetic',{
      apiVersion:STRIPE_API_VERSION,maxNetworkRetries:0,timeout:10_000,
    });
    expect(sdk.account).toHaveBeenCalledWith(null);
    expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
      mode:'payment',payment_method_types:['card'],client_reference_id:correlation.bookingId,
      success_url:base.successUrl,cancel_url:base.cancelUrl,expires_at:base.expiresAt,
      allow_promotion_codes:false,automatic_tax:{enabled:false},
      line_items:[{price_data:{currency:'eur',unit_amount:12345,product_data:{name}},quantity:1}],
      metadata,payment_intent_data:{metadata},
    },{idempotencyKey:base.idempotencyKey});
  });

  it('replays a legacy durable request with the original description and key',async()=>{
    await new StripeSdkGateway(config).createSession(base);
    expect(sdk.create.mock.calls[0][0].line_items?.[0].price_data?.product_data?.name)
      .toBe('Synthetic accommodation booking advance');
    expect(sdk.create.mock.calls[0][1]).toEqual({idempotencyKey:'stable-fixture-key'});
  });

  it('rejects an account mismatch before creating a Session',async()=>{
    sdk.account.mockResolvedValue({id:'acct_wrong_fixture'});
    await expect(new StripeSdkGateway(config).createSession({...base,paymentPurpose:'BALANCE'}))
      .rejects.toThrow('Stripe test account mismatch');
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('rejects live Session evidence from the SDK',async()=>{
    sdk.create.mockResolvedValue({id:'cs_live_fixture',livemode:true});
    await expect(new StripeSdkGateway(config).createSession({...base,paymentPurpose:'INITIAL_FULL'}))
      .rejects.toThrow('Live Stripe Session rejected');
  });
});
