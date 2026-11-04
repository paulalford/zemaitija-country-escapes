import 'server-only';
import { AutomationError, type AutomationFailure, type AutomationConfig } from './stripe-automation-config';
// Type-only integration keeps all executable recovery/client imports out of the route.
export type { RecoveryProcessors, AutomationVerificationDependencies } from './stripe-automation-runner';

export const AUTOMATION_LANES = Object.freeze([
  'PAYMENT_WEBHOOKS', 'CHECKOUT_COMMAND_RECOVERY', 'INITIAL_RECONCILIATION',
  'BALANCE_RECONCILIATION', 'DEFERRED_INVESTIGATION',
] as const);
export type AutomationLane = typeof AUTOMATION_LANES[number];
export const AUTOMATION_BUDGET = Object.freeze({
  admissionMilliseconds: 15_000, concurrency: 1,
  perLane: Object.freeze({ PAYMENT_WEBHOOKS: 2, CHECKOUT_COMMAND_RECOVERY: 1,
    INITIAL_RECONCILIATION: 1, BALANCE_RECONCILIATION: 1, DEFERRED_INVESTIGATION: 0 }),
});
export type LaneResult = Readonly<{
  lane: AutomationLane; state: 'NOT_EXECUTED'; attempted: 0; completed: 0; failed: 0;
}>;
export type AutomationSummary = Readonly<{
  stage: '2A'; status: 'INACTIVE'; processingEnabled: false;
  reason: 'STAGE_2A_INACTIVE'; lanes: readonly LaneResult[];
}>;
/** Future injection contract only. Stage 2A never reads or calls these dependencies. */
export type AutomationDependencies = Readonly<{
  constructDatabase?: () => unknown;
  constructStripe?: () => unknown;
  processors?: Partial<Record<AutomationLane, (limit: number) => Promise<unknown>>>;
}>;
export function classifyAutomationFailure(error: unknown): AutomationFailure | 'INTERNAL' {
  return error instanceof AutomationError ? error.code : 'INTERNAL';
}

/** Hard implementation gate: configuration/DI cannot enable processing in Stage 2A. */
export function runStripeAutomationFoundation(
  _config: AutomationConfig, _dependencies?: AutomationDependencies,
): AutomationSummary {
  // Intentionally consume neither configuration properties nor injected capabilities.
  void _config;
  void _dependencies;
  return Object.freeze({ stage: '2A', status: 'INACTIVE', processingEnabled: false,
    reason: 'STAGE_2A_INACTIVE', lanes: Object.freeze(AUTOMATION_LANES.map(lane => Object.freeze({
      lane, state: 'NOT_EXECUTED' as const, attempted: 0 as const, completed: 0 as const, failed: 0 as const,
    }))) });
}
