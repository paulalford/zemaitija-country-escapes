import { z } from 'zod';

/** Pure preconnection contract. A supplied approval record is not independent proof
 * of owner authority, resource freshness or physical cluster identity. Run 2 must
 * verify those externally and attest actual sessions before any fixture writes. */
const identity = z.object({
  runId: z.uuid(), clusterId: z.uuid(), host: z.literal('127.0.0.1'),
  port: z.number().int().min(55440).max(65535), database: z.string(),
  schema: z.literal('m19-baseline-through-0035'), postgresVersion: z.literal(170006),
  migrationRole: z.literal('zemaitija_migrator'), runtimeRole: z.literal('zemaitija_app'),
}).strict();
const approvalSchema = z.object({
  reference: z.string().regex(/^owner:m19:run2:[a-z0-9-]{8,80}$/),
  resource: identity, notBefore: z.number().int(), expiresAt: z.number().int(),
  operations: z.tuple([z.literal('synthetic-postgres-qa')]),
  disposition: z.literal('retain-on-failure-no-automatic-destruction'),
}).strict();
export type M19Identity = z.infer<typeof identity>;
export type M19Approval = z.infer<typeof approvalSchema>;
export const M19_TARGET_REJECTED = 'M19_DATABASE_APPROVAL_OR_TARGET_REJECTED';

export function validateM19Target(target: unknown, approval: unknown, migration: string,
  runtime: string, now = Date.now()) {
  try {
    const resource = identity.parse(target), grant = approvalSchema.parse(approval);
    for (const key of Object.keys(resource) as (keyof M19Identity)[])
      if (resource[key] !== grant.resource[key]) throw Error();
    if (!Number.isSafeInteger(now) || now < grant.notBefore || now >= grant.expiresAt ||
      grant.expiresAt - grant.notBefore > 4 * 60 * 60 * 1000) throw Error();
    if (resource.database !== `zemaitija_m19_${resource.runId.replaceAll('-', '')}_dev`) throw Error();
    const urls = [migration, runtime].map(raw => new URL(raw));
    for (const [i, url] of urls.entries()) {
      const role = i === 0 ? resource.migrationRole : resource.runtimeRole;
      if (url.protocol !== 'postgresql:' || url.hostname !== resource.host || Number(url.port) !== resource.port ||
        url.pathname !== `/${resource.database}` || url.username !== role || !url.password ||
        url.search || url.hash || /[%\\\s]/.test(url.pathname + url.username)) throw Error();
    }
    if (decodeURIComponent(urls[0].password) === decodeURIComponent(urls[1].password)) throw Error();
    return Object.freeze({ resource: Object.freeze(resource), migrationUrl: urls[0].href, runtimeUrl: urls[1].href });
  } catch { throw Error(M19_TARGET_REJECTED); }
}

/** No default URLs, env-file loading, connections, or fallback to application env. */
export function m19DatabaseTarget(env: Record<string, string | undefined> = process.env) {
  try {
    if (env.M19_POSTGRES_EXECUTION !== 'OWNER_APPROVED_RUN_2') throw Error();
    return validateM19Target(JSON.parse(env.M19_POSTGRES_TARGET ?? ''), JSON.parse(env.M19_POSTGRES_APPROVAL ?? ''),
      env.M19_MIGRATION_URL ?? '', env.M19_RUNTIME_URL ?? '');
  } catch { throw Error(M19_TARGET_REJECTED); }
}
