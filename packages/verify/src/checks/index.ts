// Built-in checks. Each check lives in its own module in this folder and no shared file lists them:
// to add a check, create a module that exports it, run `npm run build`, then `node tools/gen-registries.mjs`,
// which regenerates registry.ts (imports plus the ID-sorted array).

export { builtInChecks } from "./registry.js";
