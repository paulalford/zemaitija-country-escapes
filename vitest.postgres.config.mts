import { defineConfig } from 'vitest/config';
import { m19DatabaseTarget } from './tests/helpers/m19-database-target';

// Preparation only: no dependency construction or suite collection in Run 1.
// Even valid coordinate/approval syntax cannot prove actual session identity.
export default defineConfig(() => {
  m19DatabaseTarget();
  throw Error('M19_RUN2_INDEPENDENT_RESOURCE_AND_SESSION_PREFLIGHT_REQUIRED');
});
