import { defineConfig } from "vitest/config";

// Server-side tests share one PostgreSQL; each test file creates its own database from the migrations.
export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/api/test/**/*.test.ts",
      "apps/jobs/test/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});
