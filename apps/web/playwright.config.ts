import { defineConfig, devices } from "@playwright/test";

// The console against the real API (AUTH_MODE=dev) on a migrated, seeded database (ROP_DATABASE_URL).
const db = process.env.ROP_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/rop";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
  ],
  webServer: [
    {
      command: "pnpm --dir ../.. exec tsx apps/api/src/main.ts",
      url: "http://127.0.0.1:8080/health/ready",
      env: { AUTH_MODE: "dev", ROP_DATABASE_URL: db, LOG_LEVEL: "warn" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm preview",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
