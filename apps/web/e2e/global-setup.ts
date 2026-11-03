import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  execFileSync("pnpm", ["exec", "tsx", "scripts/e2e-reset.ts"], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      ROP_DATABASE_URL: process.env.ROP_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/rop",
    },
  });
}
