import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { StripeGateway } from './stripe-adapter';
import type { RecoveryProcessors } from './stripe-automation-runner';
import { processPaymentWebhookInbox } from './stripe-webhooks';
import { recoverSessionCommands } from './checkout-worker';
import { recoverInitialAttempts } from './payment-reconciliation';
import { recoverBalanceAttempts } from './balance-payment';

/** Explicit injected wiring. No client construction, environment loading or execution
 * at import, and no connection from the Stage 2A endpoint to this factory. */
export function automationRecoveryProcessors(pool:Pool,gateway:StripeGateway,
  urls:{successUrl:string;cancelUrl:string}):RecoveryProcessors {
  return {
    PAYMENT_WEBHOOKS:async(limit,options)=>{const r=await processPaymentWebhookInbox(pool,gateway,limit,options);
      return {attempted:r.attempted,processed:r.processed,deferred:r.deferred,retried:r.retried,
        failed:r.failed,investigationRequired:r.investigationRequired,financialSucceeded:r.financialSucceeded};},
    CHECKOUT_COMMAND_RECOVERY:async(limit,options)=>{
      const {items:_,...counts}=await recoverSessionCommands(pool,gateway,randomUUID(),urls,limit,options);
      void _;return counts;
    },
    INITIAL_RECONCILIATION:async(limit,options)=>{
      const {items:_,...counts}=await recoverInitialAttempts(pool,gateway,limit,options);void _;return counts;
    },
    BALANCE_RECONCILIATION:async(limit,options)=>{
      const {items:_,...counts}=await recoverBalanceAttempts(pool,gateway,limit,options);void _;return counts;
    },
  };
}
