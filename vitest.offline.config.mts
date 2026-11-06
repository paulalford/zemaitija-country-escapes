import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

import { offlineSuites, databaseSuites, deferredSuites, validateOfflineArguments } from './tests/helpers/m19-suite-selection';

validateOfflineArguments(process.argv.slice(2));
// Remove inherited configuration by key, without reading or reporting its values.
for (const key of Object.keys(process.env))
  if (!/^(PATH|LANG|LC_ALL|TZ|TMPDIR|CI|NODE_ENV|VITEST.*)$/.test(key)) delete process.env[key];
process.env.NODE_ENV = 'test';

export default defineConfig({
  envDir: false,
  cacheDir: '/tmp/m19-run1/vite-cache',
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname,
    'server-only': new URL('./tests/server-only-stub.ts', import.meta.url).pathname } },
  plugins: [{ name: 'm19-reviewed-test-imports', enforce: 'pre',
    resolveId(source, importer) {
      if (/\.(?:test|spec)\.[cm]?[jt]sx?(?:$|\?)/.test(source)) {
        const clean = source.replace(/^\/@fs\//, '/').split('?')[0];
        const absolute = clean.startsWith('/tests/') ? resolve(`.${clean}`) :
          clean.startsWith('.') && importer ? resolve(importer.split('/').slice(0,-1).join('/'), clean) : resolve(clean);
        if (!offlineSuites.some(path => resolve(path) === absolute)) throw Error('M19_NON_ALLOWLISTED_TEST_IMPORT');
      }
    },
  }],
  test: { include: [...offlineSuites], exclude: [...databaseSuites, ...deferredSuites],
    setupFiles: ['./tests/helpers/m19-offline-safety.ts'],
    pool: 'threads', maxWorkers: 1, fileParallelism: false, isolate: true,
    watch: false, cache: false, coverage: { enabled: false },
    server: { deps: { inline: ['stripe', 'pg'] } },
  },
});
