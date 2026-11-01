import { defineConfig } from 'vitest/config';

// Native-only suite: live-service tests excluded from the default run.
// Run via `pnpm test:identity:native` with DATABASE_URL set against a
// disposable database; never merged into `pnpm test`.
export default defineConfig({
  test: {
    include: ['tests/native/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'runs', 'fixtures'],
    environment: 'node',
    // One disposable database per run: files share it, so they run
    // sequentially — each file's beforeAll resets the schema it needs.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
    // Same as the default suite: no retries — a flaky native proof must surface.
    retry: 0,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
