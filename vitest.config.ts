import { defineConfig } from 'vitest/config';

// Single host package. Tests are split by concern so the phase-1 acceptance
// commands can run one family at a time and report mock/pure results
// separately from native toolchain conformance.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'runs', 'fixtures', 'tests/native/**'],
    environment: 'node',
    reporters: ['default'],
    // Policy/contract tests assert determinism: same input -> same digest.
    // No retries — a flaky verdict test must surface, not be retried away.
    retry: 0,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
