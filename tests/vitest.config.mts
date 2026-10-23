// Integration tests: real PostgreSQL (driveeasy_test), real server modules.
// Run with `pnpm test:integration`. Unit tests stay in vitest.config.mts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "integration",
    root: process.cwd(),
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // One shared database: run files one at a time so resets don't collide.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
