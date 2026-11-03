// Write the generated files; `pnpm generate --check` fails when a committed one is out of date (CI runs it).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "@rop/platform";
import { generatedFiles } from "./generated";

const check = process.argv.includes("--check");
const files = await generatedFiles();
const stale: string[] = [];
for (const [rel, content] of Object.entries(files)) {
  const p = join(ROOT, rel);
  const current = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (current === content) continue;
  if (check) stale.push(rel);
  else {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    console.log(`wrote ${rel}`);
  }
}
if (stale.length) {
  console.error(`out of date (run pnpm generate): ${stale.join(", ")}`);
  process.exit(1);
}
