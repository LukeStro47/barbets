import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests hit a shared hosted Supabase project (no local
    // Docker instance available) — run test files sequentially so
    // concurrent runs never race on the same project-wide resources (e.g.
    // pg_cron-adjacent expire_stale side effects).
    fileParallelism: false,
  },
});
