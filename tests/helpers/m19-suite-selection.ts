/** Exact reviewed modules, not glob discovery. New tests require source review. */
export const offlineSuites = [
  "tests/milestone15-calendar.test.tsx",
  "tests/milestone15.test.tsx",
  "tests/milestone16-presentation.test.tsx",
  "tests/milestone16.test.ts",
  "tests/milestone17.test.tsx",
  "tests/milestone18.test.tsx",
  "tests/stripe-acceptance-compatibility.test.ts",
  "tests/stripe-acceptance-forwarding.test.ts",
  "tests/stripe-acceptance-host.test.ts",
  "tests/stripe-acceptance-integration.test.ts",
  "tests/stripe-acceptance-remediation-a.test.ts",
  "tests/stripe-acceptance-remediation-b.test.ts",
  "tests/stripe-acceptance-remediation-c.test.ts",
  "tests/stripe-acceptance-run.test.ts",
  "tests/stripe-acceptance-scenarios.test.ts",
  "tests/stripe-acceptance-supervision.test.ts",
  "tests/stripe-acceptance-transport.test.ts",
  "tests/stripe-acceptance-verifier.test.ts",
  "tests/stripe-acceptance.test.ts",
  "tests/stripe-adapter.test.ts",
  "tests/stripe-automation-foundation.test.ts",
  "tests/stripe-automation-hardening.test.ts",
  "tests/stripe-automation-migration-diagnostics.test.ts",
  "tests/stripe-automation-preparation.test.ts",
  "tests/stripe-automation-prerequisites.test.ts",
  "tests/stripe-automation-runtime.test.ts",
  "tests/stripe-balance-smoke.test.ts",
  "tests/stripe-recovery-domain.test.ts",
  "tests/stripe-recovery-enrollment.test.ts",
  "tests/stripe-recovery-scheduling.test.ts",
  "tests/m19-test-safety.test.ts",
  "tests/quote-math.test.ts",
  "tests/cancellation-math.test.ts",
  "tests/m19-security-boundaries.test.ts",
  "tests/m19-webhook-signature.test.ts"
] as const;
export const databaseSuites = [
  "tests/availability.test.ts",
  "tests/database.test.ts",
  "tests/milestone09.test.ts",
  "tests/milestone10.test.ts",
  "tests/milestone11.test.ts",
  "tests/milestone12.test.ts",
  "tests/milestone13.test.ts",
  "tests/milestone14.test.ts",
  "tests/milestone16-checkout-recovery.test.ts",
  "tests/milestone16-postgres.test.ts",
  "tests/quote.test.ts",
  "tests/reference.test.ts"
] as const;
export const deferredSuites = ['tests/stripe-automation-typescript-loader.test.ts'] as const;

export function validateOfflineArguments(args: readonly string[]) {
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === 'run' || value === '--reporter=dot' || value === '--reporter=verbose' || value === '--configLoader=runner') continue;
    if (value === '--config' && ['vitest.config.mts', 'vitest.offline.config.mts'].includes(args[++i])) continue;
    if ((offlineSuites as readonly string[]).includes(value)) continue;
    throw Error('M19_OFFLINE_ARGUMENT_NOT_ALLOWLISTED');
  }
}
