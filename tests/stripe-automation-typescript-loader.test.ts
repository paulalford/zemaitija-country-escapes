import { beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

const hooks=vi.hoisted(()=>({registerHooks:vi.fn()}));
// Capture the real module's hook without installing a process-wide resolver.
vi.mock('node:module',()=>({registerHooks:hooks.registerHooks}));

type Context={parentURL?:string;conditions?:string[]};
type Resolution={url:string};
type NextResolve=(specifier:string,context:Context)=>Resolution;
type Resolve=(specifier:string,context:Context,nextResolve:NextResolve)=>Resolution;
const root=new URL('../',import.meta.url);
const context:Context={parentURL:new URL('scripts/stripe-automation-postgres-acceptance.ts',root).href,
  conditions:['node','react-server']};
let resolve:Resolve;

beforeAll(async()=>{
  const loader=new URL('../scripts/lib/stripe-automation-typescript-loader.mjs',import.meta.url);
  await import(loader.href);
  expect(hooks.registerHooks).toHaveBeenCalledOnce();
  resolve=hooks.registerHooks.mock.calls[0][0].resolve;
});

describe('isolated host TypeScript loader (no module execution)',()=>{
  it.each([
    ['./lib/stripe-automation-connection','scripts/lib/stripe-automation-connection.ts'],
    ['../tests/stripe-automation-postgres.scenarios','tests/stripe-automation-postgres.scenarios.ts'],
    ['./lib/synthetic.fixture.scenarios','scripts/lib/synthetic.fixture.scenarios.ts'],
  ])('resolves repository-relative %s to its TypeScript filename', (specifier,target)=>{
    const result={url:new URL(target,root).href};
    const next=vi.fn<NextResolve>(()=>result);
    expect(resolve(specifier,context,next)).toBe(result);
    expect(next).toHaveBeenCalledExactlyOnceWith(result.url,context);
    expect(next.mock.calls[0][1]).toBe(context);
    expect(context.conditions).toContain('react-server');
  });

  it.each(['ts','js','mjs','mts','cts','cjs','tsx','jsx','TS','MJS'])(
    'delegates explicit .%s imports without rewriting',extension=>{
      const specifier=`./lib/synthetic.fixture.${extension}`;
      const result={url:'synthetic:delegated'},next=vi.fn(()=>result);
      expect(resolve(specifier,context,next)).toBe(result);
      expect(next).toHaveBeenCalledExactlyOnceWith(specifier,context);
    });

  it.each(['pg','stripe','drizzle-orm/pg-core','@scope/package.scenarios','node:fs'])(
    'does not intercept package or builtin import %s',specifier=>{
      const result={url:'synthetic:package'},next=vi.fn(()=>result);
      expect(resolve(specifier,context,next)).toBe(result);
      expect(next).toHaveBeenCalledExactlyOnceWith(specifier,context);
    });

  it.each(['../../outside','../../outside.scenarios'])(
    'rejects repository traversal %s before invoking the next resolver',specifier=>{
      const next=vi.fn();
      expect(()=>resolve(specifier,context,next)).toThrow('HOST_TOOL_IMPORT_OUTSIDE_REPOSITORY');
      expect(next).not.toHaveBeenCalled();
    });

  it('preserves missing-module rejection without retries or a fallback',()=>{
    const error=Object.assign(new Error('Synthetic missing module'),{code:'ERR_MODULE_NOT_FOUND'});
    const next=vi.fn(()=>{throw error;});
    expect(()=>resolve('./lib/missing.scenarios',context,next)).toThrow(error);
    expect(next).toHaveBeenCalledExactlyOnceWith(new URL('scripts/lib/missing.scenarios.ts',root).href,context);
  });

  it.each([{}, {parentURL:new URL('../outside.ts',root).href}])(
    'delegates imports without an approved repository parent',parent=>{
      const next=vi.fn(()=>({url:'synthetic:delegated'}));
      resolve('./synthetic.scenarios',parent,next);
      expect(next).toHaveBeenCalledExactlyOnceWith('./synthetic.scenarios',parent);
    });

  it.each([
    'node_modules/pg/lib/index.js','node_modules/pg/lib/client.js',
    'node_modules/pg/esm/index.mjs','node_modules/@scope/package/index.ts',
    'scripts/node_modules/pg/lib/index.js','src/nested/node_modules/package/index.js',
    'tests/node_modules/package/index.ts','scripts/%6eode_modules/pg/lib/index.js',
    'scripts/nested/node_modules/outer/node_modules/pg/lib/index.cjs',
  ])('delegates relative dependency imports from %s without appending .ts',parent=>{
    const dependencyContext={...context,parentURL:new URL(parent,root).href};
    const result={url:new URL('node_modules/pg/lib/client.js',root).href};
    const next=vi.fn(()=>result);
    expect(resolve('./client',dependencyContext,next)).toBe(result);
    expect(next).toHaveBeenCalledExactlyOnceWith('./client',dependencyContext);
    expect(result.url).not.toMatch(/\.ts$/);
  });

  it.each(['docs/example.ts','next.config.ts','scripts/synthetic.json'])(
    'delegates resolution from non-source parent %s',parent=>{
      const outsideContext={...context,parentURL:new URL(parent,root).href};
      const next=vi.fn(()=>({url:'synthetic:native'}));
      resolve('./synthetic',outsideContext,next);
      expect(next).toHaveBeenCalledExactlyOnceWith('./synthetic',outsideContext);
    });

  it.each(['../node_modules/pg/lib/client','./node_modules/pg/lib/client','../docs/synthetic'])(
    'does not rewrite project-relative imports into dependency or non-source files: %s',specifier=>{
      const next=vi.fn(()=>({url:'synthetic:native'}));
      resolve(specifier,context,next);
      expect(next).toHaveBeenCalledExactlyOnceWith(specifier,context);
    });

  it.each(['src/server/example.ts','tests/example.scenarios.ts','scripts/example.mjs'])(
    'allows extensionless project imports from approved source %s',parent=>{
      const sourceContext={...context,parentURL:new URL(parent,root).href};
      const next=vi.fn(()=>({url:'synthetic:project'}));
      resolve('./synthetic.scenarios',sourceContext,next);
      expect(next).toHaveBeenCalledExactlyOnceWith(new URL('./synthetic.scenarios.ts',sourceContext.parentURL).href,sourceContext);
    });
});

it('imports the migration launcher and real pg ESM/CommonJS with the real hook, without resource construction',()=>{
  const loader=new URL('../scripts/lib/stripe-automation-typescript-loader.mjs',import.meta.url);
  const launcher=new URL('../scripts/stripe-automation-migrate.ts',import.meta.url);
  const script=`
    import assert from 'node:assert/strict';
    import { createRequire, registerHooks } from 'node:module';
    import net from 'node:net';
    import tls from 'node:tls';
    import childProcess from 'node:child_process';
    const forbidden=()=>{throw Error('IMPORT_ONLY_RESOURCE_ACCESS_FORBIDDEN');};
    net.Socket.prototype.connect=forbidden;
    tls.connect=forbidden;
    childProcess.execFile=forbidden;
    childProcess.spawn=forbidden;
    process.loadEnvFile=forbidden;
    globalThis.fetch=forbidden;
    registerHooks({resolve(specifier,context,nextResolve){
      if(specifier==='stripe' || /\\/src\\/db\\/client(?:\\.ts)?$/.test(specifier))forbidden();
      return nextResolve(specifier,context);
    }});
    assert.equal(process.argv[1],undefined);
    assert.deepEqual(Object.keys(process.env),['NODE_ENV']);
    const require=createRequire(${JSON.stringify(launcher.href)});
    const cjs=require('pg');
    assert.equal(typeof cjs.Client,'function');
    assert.equal(typeof cjs.Pool,'function');
    assert.ok(require.resolve('pg').endsWith('/pg/lib/index.js'));
    const esm=await import('pg');
    assert.equal(esm.default,cjs);
    for(const key of ['Client','Pool']) {
      cjs[key].prototype.connect=forbidden;
      cjs[key]=new Proxy(cjs[key],{construct:forbidden});
    }
    const migration=await import(${JSON.stringify(launcher.href)});
    assert.equal(typeof migration.migrationMain,'function');
    assert.equal(typeof migration.executeIsolatedMigrations,'function');
    process.stdout.write('IMPORT_ONLY_PG_COMMONJS_ESM_AND_LAUNCHER_OK\\n');
  `;
  const result=spawnSync(process.execPath,[
    '--experimental-transform-types','--conditions=react-server','--import',loader.href,
    '--input-type=module','--eval',script,
  ],{cwd:root,env:{NODE_ENV:'test'},encoding:'utf8',timeout:10000,maxBuffer:64*1024});
  expect(result.error).toBeUndefined();
  expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toBe('IMPORT_ONLY_PG_COMMONJS_ESM_AND_LAUNCHER_OK\n');
});
