// Bundle the API and the Azure Functions entry with esbuild into dist/. Each bundle reads config/ at runtime
// from ROP_ROOT (the container and the function package copy config/ next to the bundle).
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node" as const,
  target: "node22",
  format: "esm" as const,
  sourcemap: true,
  // pg's optional native binding and the Azure SDK's optional peers are not used.
  // @azure/functions-core is provided by the Functions host at run time.
  external: ["pg-native", "@azure/functions-core"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await build({ ...common, entryPoints: ["apps/api/src/main.ts"], outfile: "dist/api/main.js" });
await build({ ...common, entryPoints: ["apps/jobs/src/azure.ts"], outfile: "dist/jobs/index.js" });
console.log("built dist/api/main.js and dist/jobs/index.js");
