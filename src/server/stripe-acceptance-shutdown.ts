import 'server-only';
import { z } from 'zod';
import { requireSealedAcceptanceRun, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { SUPERVISION_POLICY, type DurableSupervisionStore, type FutureExclusiveLocks } from './stripe-acceptance-supervision';
import type { AtomicEvidenceCell, ProtectedHeadPort, DurableProviderBudget } from './stripe-acceptance-durable';

/** Future Linux Mint policy descriptor only. No command, unit, process handle,
 * signal sender, timer callback or automatic restart implementation exists. */
export const ACCEPTANCE_PROCESS_POLICY = Object.freeze({
  serviceIdentity: SUPERVISION_POLICY.serviceIdentity, serviceGroup: SUPERVISION_POLICY.serviceIdentity, serviceType: 'oneshot', serviceEnabled: false,
  timerEnabled: false, timerPersistent: false, installationAuthorised: false, executable: false,
  hostLock: SUPERVISION_POLICY.hostLock, invocationMilliseconds: SUPERVISION_POLICY.maxInvocationMilliseconds,
  outerLifetimeMilliseconds: 65000, terminationGraceMilliseconds: 5000,
  cooperativeSignal: 'SIGTERM', hardSignal: 'SIGKILL', killScope: 'ENTIRE_SERVICE_CGROUP', restart: 'NO',
  recovery: 'VERIFY_JOURNAL_BUDGET_AND_INDEPENDENT_HEAD_BEFORE_NEW_APPROVAL',
  uncertainty: 'RETAIN_ALLOWANCE_AND_HALT_NO_AUTOMATIC_REISSUE',
} as const);
/** Existing persistence/lock interfaces remain the sole future mutation seams.
 * This type is documentation, not a constructor; C inspectors accept no writers. */
export type FutureAcceptancePersistence = Readonly<{ journal: DurableSupervisionStore; journalCell: AtomicEvidenceCell;
  protectedJournalHead: ProtectedHeadPort; aggregateBudget: DurableProviderBudget; locks: FutureExclusiveLocks }>;
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
const observation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('START_OBSERVED'), at: time, pid: z.number().int().positive(), cgroupId: label }).strict(),
  z.object({ kind: z.literal('STOP_REQUIRED'), at: time, reason: z.enum(['SIGTERM', 'CANCELLED', 'DEADLINE', 'LOCK_LOST', 'STORAGE_UNCERTAIN']) }).strict(),
  z.object({ kind: z.literal('SIGTERM_OBSERVED'), at: time, cgroupId: label }).strict(),
  z.object({ kind: z.literal('SIGKILL_OBSERVED'), at: time, cgroupId: label }).strict(),
  z.object({ kind: z.literal('EXIT_OBSERVED'), at: time, cgroupId: label, descendantsGone: z.boolean() }).strict(),
  z.object({ kind: z.literal('CLEANUP_OBSERVED'), at: time, outcome: z.enum(['SETTLED', 'UNCERTAIN']) }).strict(),
]);
export const shutdownTimelineSchema = z.object({ invocationId: z.uuid().nullable(), deadline: time.nullable(),
  complete: z.literal(true), observations: z.array(observation).max(128) }).strict();
export type ShutdownTimeline = z.infer<typeof shutdownTimelineSchema>;
export const SHUTDOWN_DIAGNOSTICS = ['PROCESS_NOT_STARTED', 'PROCESS_OBSERVED', 'STOP_REQUIRED', 'SIGTERM_MISSING',
  'HARD_TERMINATION_DUE', 'DESCENDANTS_UNCERTAIN', 'CLEANUP_PENDING', 'CLEANUP_UNCERTAIN', 'PROCESS_SETTLED',
  'SHUTDOWN_EVIDENCE_INVALID', 'DEADLINE_MISSED', 'STORAGE_UNCERTAIN'] as const;
export type ShutdownDiagnostic = typeof SHUTDOWN_DIAGNOSTICS[number];
/** Read-only observation fold. A due signal is a diagnostic, never an action.
 * Process exit/cleanup cannot establish payment outcome, rollback or quota refund. */
export function inspectAcceptanceShutdown(run: SealedAcceptanceRun, raw: unknown, now: number) {
  const diagnostics = new Set<ShutdownDiagnostic>();
  let state: 'NOT_STARTED' | 'OBSERVED_RUNNING' | 'CANCELLING' | 'HALTED' | 'SETTLED' | 'UNKNOWN' = 'UNKNOWN';
  let deadline: number | null = null, stopAt: number | null = null, hardTerminationDueAt: number | null = null;
  let descendantsGone = false, cleanup: 'PENDING' | 'SETTLED' | 'UNCERTAIN' = 'PENDING';
  let invocationId: string | null = null, startedAt: number | null = null;
  try {
    requireSealedAcceptanceRun(run);
    const p = shutdownTimelineSchema.parse(raw); invocationId = p.invocationId; deadline = p.deadline;
    if (!Number.isSafeInteger(now) || now < Date.parse(run.notBefore)) throw Error();
    if (!p.observations.length) {
      if (p.invocationId !== null || p.deadline !== null) throw Error();
      state = 'NOT_STARTED'; diagnostics.add('PROCESS_NOT_STARTED');
    } else {
      const first = p.observations[0];
      if (first.kind !== 'START_OBSERVED' || !p.invocationId || deadline === null || first.at < Date.parse(run.notBefore) ||
        first.at >= deadline || deadline > Math.min(first.at + ACCEPTANCE_PROCESS_POLICY.invocationMilliseconds, Date.parse(run.expiresAt))) throw Error();
      startedAt = first.at;
      let previous = first.at, term = false, killed = false, exited = false, cleanupObserved = false;
      state = 'OBSERVED_RUNNING';
      for (const [i, e] of p.observations.entries()) {
        if (e.at < previous || e.at > now) throw Error(); previous = e.at;
        if (i === 0) continue;
        if (e.kind === 'START_OBSERVED') throw Error();
        if (e.kind === 'STOP_REQUIRED') {
          if (exited || stopAt !== null || e.reason === 'DEADLINE' && e.at < deadline) throw Error();
          stopAt = e.at;
          if (e.reason === 'STORAGE_UNCERTAIN') diagnostics.add('STORAGE_UNCERTAIN');
        }
        if (e.kind === 'SIGTERM_OBSERVED') {
          if (term || exited || e.cgroupId !== first.cgroupId) throw Error();
          stopAt ??= e.at; term = true;
        }
        if (e.kind === 'SIGKILL_OBSERVED') {
          if (!term || killed || exited || stopAt === null || e.at < Math.min(stopAt, deadline) + ACCEPTANCE_PROCESS_POLICY.terminationGraceMilliseconds ||
            e.cgroupId !== first.cgroupId) throw Error();
          killed = true;
        }
        if (e.kind === 'EXIT_OBSERVED') {
          if (exited || e.cgroupId !== first.cgroupId) throw Error();
          exited = true; descendantsGone = e.descendantsGone;
        }
        if (e.kind === 'CLEANUP_OBSERVED') {
          if (!exited || cleanupObserved || e.outcome === 'SETTLED' && !descendantsGone) throw Error();
          cleanupObserved = true; cleanup = e.outcome;
        }
      }
      if (!exited && now >= deadline) { stopAt = Math.min(stopAt ?? deadline, deadline); diagnostics.add('DEADLINE_MISSED'); }
      if (stopAt !== null) {
        hardTerminationDueAt = Math.min(stopAt, deadline) + ACCEPTANCE_PROCESS_POLICY.terminationGraceMilliseconds;
        state = 'CANCELLING'; diagnostics.add('STOP_REQUIRED');
        if (!term && !exited) diagnostics.add('SIGTERM_MISSING');
        if (!exited && now >= hardTerminationDueAt) { state = 'HALTED'; diagnostics.add('HARD_TERMINATION_DUE'); }
      }
      if (exited) {
        if (!descendantsGone) { state = 'HALTED'; diagnostics.add('DESCENDANTS_UNCERTAIN'); }
        else if (cleanup === 'SETTLED') { state = 'SETTLED'; diagnostics.add('PROCESS_SETTLED'); }
        else if (cleanup === 'UNCERTAIN') { state = 'HALTED'; diagnostics.add('CLEANUP_UNCERTAIN'); }
        else { state = 'CANCELLING'; diagnostics.add('CLEANUP_PENDING'); }
      } else diagnostics.add('PROCESS_OBSERVED');
      // Late exit is still evidence of a missed bound, even after cleanup settles.
      const exitAt = p.observations.find(e => e.kind === 'EXIT_OBSERVED')?.at;
      if (exitAt !== undefined && exitAt >= deadline) diagnostics.add('DEADLINE_MISSED');
      if (exitAt !== undefined && (exitAt > first.at + ACCEPTANCE_PROCESS_POLICY.outerLifetimeMilliseconds ||
        hardTerminationDueAt !== null && exitAt > hardTerminationDueAt)) {
        state = 'HALTED'; diagnostics.add('HARD_TERMINATION_DUE');
      }
    }
  } catch { state = 'UNKNOWN'; diagnostics.add('SHUTDOWN_EVIDENCE_INVALID'); }
  return Object.freeze({ readiness: 'NOT_READY' as const, operationsEnabled: false as const, schedulingEnabled: false as const,
    state, invocationId, startedAt, deadline, hardTerminationDueAt, descendantsGone, cleanup,
    financialOutcome: 'UNKNOWN' as const, automaticRestartAllowed: false as const,
    diagnostics: Object.freeze([...diagnostics].sort()) });
}
