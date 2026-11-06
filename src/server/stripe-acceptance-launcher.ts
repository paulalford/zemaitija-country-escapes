import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';
import { loadProtectedFreshIntegration, type ProtectedDescriptorIO } from './stripe-acceptance-trust';
import { inspectFreshRunnerBinding } from './stripe-acceptance-fresh-runner';
import { inspectAcceptanceMonitoring, type AcceptanceMonitorReaders } from './stripe-acceptance-monitoring';
import { ACCEPTANCE_PROCESS_POLICY } from './stripe-acceptance-shutdown';

export const TRUSTED_LAUNCHER_SEQUENCE = Object.freeze(['PROTECTED_HOST_CONFIGURATION', 'REVIEWED_ARTIFACT_INTEGRITY',
  'INDEPENDENT_OWNER_APPROVAL', 'EXCLUSIVE_RESOURCE_RESERVATION', 'FRESH_DOCKER_POSTGRES', 'PROTECTED_JOURNAL_AND_BUDGET',
  'EXCLUSIVE_HOST_DATABASE_LOCKS', 'BUDGETED_STRIPE_TEST_IDENTITY', 'RUNNER_AND_COLLECTOR_BINDING',
  'IMMEDIATE_AUTHORITY_REVALIDATION'] as const);
const requestSchema = z.object({ mode: z.literal('source-only'), profileId: z.literal('stage-2c-fresh-pg17-v1'), runId: z.uuid() }).strict();
export const LAUNCHER_DIAGNOSTICS = ['SOURCE_ONLY_DISABLED', 'INVALID_CONFIGURATION_OR_SEAL', 'PROTECTED_CONFIGURATION_REQUIRED',
  'PROTECTED_CONFIGURATION_REJECTED', 'FOREIGN_RUN', 'MONITOR_HALTED', 'AUTHORITY_CHANGED', 'REVALIDATION_REJECTED',
  'OPERATIONAL_IMPLEMENTATION_AND_APPROVAL_REQUIRED', 'CANCELLED'] as const;
type LauncherDiagnostic = typeof LAUNCHER_DIAGNOSTICS[number];
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
/** Disabled trusted-launcher foundation. ProtectedDescriptorIO is the accepted
 * read-only/no-follow port; no real implementation is supplied. Caller input can
 * select only its already sealed run, never a path, database, credential or action.
 * There is deliberately no worker, service, listener or provider entry point. */
export async function inspectTrustedAcceptanceLauncher(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan, request: unknown,
  deps: Readonly<{ protectedIO?: ProtectedDescriptorIO; monitor: AcceptanceMonitorReaders }>) {
  let diagnostic: LauncherDiagnostic = 'INVALID_CONFIGURATION_OR_SEAL';
  let monitor: Awaited<ReturnType<typeof inspectAcceptanceMonitoring>> | null = null;
  let revalidation: Awaited<ReturnType<typeof inspectFreshRunnerBinding>> | null = null;
  const checked: string[] = [];
  const finish = (state: 'HALTED' | 'PENDING_EVIDENCE' | 'SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED', code: LauncherDiagnostic) => Object.freeze({
    stage: '2C-REMEDIATION-C' as const, state, readiness: 'NOT_READY' as const, ready: false as const,
    operationsEnabled: false as const, schedulingEnabled: false as const, processorConstructionEnabled: false as const,
    diagnostic: code, sequence: TRUSTED_LAUNCHER_SEQUENCE, checked: Object.freeze([...checked]), policy: ACCEPTANCE_PROCESS_POLICY,
    monitoring: monitor, revalidation,
  });
  try {
    const cfg = requestSchema.parse(request);
    requireSealedAcceptanceRun(run); requireAcceptanceFixturePlan(run, plan);
    if (cfg.runId !== run.runId || cfg.profileId !== run.profileId || !same(freshAcceptanceNames(run.runId), Object.fromEntries(
      Object.keys(freshAcceptanceNames(run.runId)).map(k => [k, run.target[k as keyof typeof run.target]])))) return finish('HALTED', 'FOREIGN_RUN');
    if (deps.monitor.signal.aborted) return finish('HALTED', 'CANCELLED');
    if (!deps.protectedIO) return finish('PENDING_EVIDENCE', 'PROTECTED_CONFIGURATION_REQUIRED');
    diagnostic = 'PROTECTED_CONFIGURATION_REJECTED';
    // Approved manifest IS the host configuration. Reuse the consolidated trust
    // reader's canonical review format; do not alias 3D's different approval wire.
    const review = await loadProtectedFreshIntegration(run.runId, deps.protectedIO, deps.monitor.now);
    if (!same(review.manifest, run)) return finish('HALTED', 'FOREIGN_RUN');
    checked.push(...TRUSTED_LAUNCHER_SEQUENCE.slice(0, 3));
    monitor = await inspectAcceptanceMonitoring(run, plan, review, deps.monitor);
    if (monitor.safetyState === 'HALTED') return finish('HALTED', 'MONITOR_HALTED');
    if (monitor.runner.checked.length !== monitor.runner.constructionSequence.length || monitor.collection.verdict !== 'PASS')
      return finish('PENDING_EVIDENCE', 'OPERATIONAL_IMPLEMENTATION_AND_APPROVAL_REQUIRED');
    checked.push(...TRUSTED_LAUNCHER_SEQUENCE.slice(3, -1));
    diagnostic = 'REVALIDATION_REJECTED';
    // Reload exact protected artifacts and independent approval, then re-read the
    // entire B authority/lock/budget chain. No stored status object grants work.
    const current = await loadProtectedFreshIntegration(run.runId, deps.protectedIO, deps.monitor.now);
    if (!same(current, review)) return finish('HALTED', 'AUTHORITY_CHANGED');
    revalidation = await inspectFreshRunnerBinding(run, current, cfg, { ...deps.monitor.runner, now: deps.monitor.now, signal: deps.monitor.signal });
    if (deps.monitor.signal.aborted) return finish('HALTED', 'CANCELLED');
    if (revalidation.status === 'REJECTED' || revalidation.checked.length !== revalidation.constructionSequence.length)
      return finish('HALTED', 'REVALIDATION_REJECTED');
    monitor = await inspectAcceptanceMonitoring(run, plan, current, deps.monitor);
    if (monitor.safetyState === 'HALTED' || monitor.collection.verdict !== 'PASS') return finish('HALTED', 'REVALIDATION_REJECTED');
    checked.push('IMMEDIATE_AUTHORITY_REVALIDATION');
    return finish('SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED', 'SOURCE_ONLY_DISABLED');
  } catch { return finish('HALTED', diagnostic); }
}
