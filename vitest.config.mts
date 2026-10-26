import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname, 'server-only': new URL('./tests/server-only-stub.ts', import.meta.url).pathname } },
});
