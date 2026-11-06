import { EMPTY_JOURNAL_DIGEST, type DurableSupervisionSnapshot, type DurableSupervisionStore,
  type SupervisionBinding, type SupervisionEntry, type FutureExclusiveLocks } from '../../src/server/stripe-acceptance-supervision';

/** A simulated kernel/session registry; no filesystem locks or database sessions. */
export class SimulatedLockRegistry {
  private hosts = new Map<string, symbol>();
  private sessions = new Map<string, symbol>();
  process(machine: string) {
    const token = Symbol();
    const hosts = this.hosts, sessions = this.sessions;
    function lock(map: Map<string, symbol>, key: string) {
      const held = !map.has(key);
      if (held) map.set(key, token);
      return { observation: held ? 'ACQUIRED' as const : 'CONTENDED' as const,
        check: async () => held && map.get(key) === token ? 'HELD' as const : 'LOST' as const,
        release: async () => {
          if (!held || map.get(key) !== token) return 'UNKNOWN' as const;
          map.delete(key); return 'RELEASED' as const;
        } };
    }
    const adapter: FutureExclusiveLocks = {
      acquireHost: async () => lock(hosts, machine),
      acquireDatabase: async binding => lock(sessions, binding.controlLockKey),
    };
    const drop = (map: Map<string, symbol>) => { for (const [key, value] of map) if (value === token) map.delete(key); };
    return { adapter, dropSession: () => drop(this.sessions), exit: () => { drop(this.hosts); drop(this.sessions); } };
  }
}

/** SIMULATED persistence only. Detached committed image survives adapter restart.
 * Synchronous CAS is atomic within this fake, not evidence of PostgreSQL durability. */
export class SimulatedSupervisionDisk {
  image: DurableSupervisionSnapshot = { complete: true, durable: true, sequence: 0,
    headDigest: EMPTY_JOURNAL_DIGEST, entries: [] };
  binding: string | undefined;
  fenced = false;
  failure: 'NONE' | 'BEFORE_COMMIT' | 'AFTER_COMMIT' = 'NONE';
  connect(): DurableSupervisionStore {
    const check = (binding: SupervisionBinding) => {
      const key = JSON.stringify(binding);
      if (this.fenced || this.binding && key !== this.binding) throw Error('SIMULATED_STORE_UNAVAILABLE');
      this.binding = key;
    };
    return {
      read: async binding => { check(binding); return structuredClone(this.image); },
      compareAndAppend: async (binding, expected, entry: SupervisionEntry) => {
        check(binding);
        if (expected.sequence !== this.image.sequence || expected.headDigest !== this.image.headDigest) return 'CONFLICT';
        if (this.failure === 'BEFORE_COMMIT') { this.fenced = true; return 'UNKNOWN'; }
        this.image = structuredClone({ complete: true, durable: true, sequence: entry.sequence,
          headDigest: entry.digest, entries: [...this.image.entries, entry] });
        if (this.failure === 'AFTER_COMMIT') { this.fenced = true; return 'UNKNOWN'; }
        return 'DURABLE';
      },
    };
  }
}
