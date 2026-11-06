import Stripe from 'stripe';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ingestStripeWebhook, WebhookInputError } from '../src/server/stripe-webhooks';
import type { StripeGateway, VerifiedEvent } from '../src/server/stripe-adapter';

// Static SDK crypto only: no Stripe client, account, endpoint or transport.
const secret = 'whsec_m19_synthetic_not_a_credential';
const payload = Buffer.from('{"id":"evt_m19_synthetic","type":"checkout.session.completed","created":1,"livemode":false,"account":"acct_m19","data":{"object":{"object":"checkout.session","id":"cs_test_m19"}}}');
const signed = (bytes = payload, timestamp = Math.floor(Date.now() / 1000)) => Stripe.webhooks.generateTestHeaderString({ payload: bytes.toString(), secret, timestamp });
function verify(raw: Buffer, signature: string): VerifiedEvent {
  const e = Stripe.webhooks.constructEvent(raw, signature, secret);
  if (!('id' in e.data.object)) throw Error('Synthetic object must have an ID');
  return { id: e.id, type: e.type, created: e.created, livemode: e.livemode,
    accountId: e.account ?? '', objectType: e.data.object.object, objectId: e.data.object.id };
}
describe('M19 genuine SDK signature crypto with synthetic bytes only', () => {
  it('accepts fresh delivery of an old Event without disabling freshness tolerance', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'synthetic-inbox', inserted: true }] }));
    expect(verify(payload, signed()).created).toBe(1);
    expect(await ingestStripeWebhook({ query } as unknown as Pool, { accountId: 'acct_m19', verifyEvent: verify } as StripeGateway, payload, signed()))
      .toEqual({ duplicate: false, eventId: 'synthetic-inbox' });
    expect(query).toHaveBeenCalledOnce();
  });
  it.each(['tampered', 'stale', 'wrong-secret', 'missing'] as const)('rejects %s before any persistence', async kind => {
    const query = vi.fn();
    const raw = kind === 'tampered' ? Buffer.from(payload.toString() + ' ') : payload;
    const signature = kind === 'stale' ? signed(payload, Math.floor(Date.now() / 1000) - 600) :
      kind === 'wrong-secret' ? Stripe.webhooks.generateTestHeaderString({ payload: payload.toString(), secret: 'whsec_other_synthetic' }) : kind === 'missing' ? '' : signed();
    await expect(ingestStripeWebhook({ query } as unknown as Pool, { accountId: 'acct_m19', verifyEvent: verify } as StripeGateway, raw, signature)).rejects.toBeInstanceOf(WebhookInputError);
    expect(query).not.toHaveBeenCalled();
  });
});
