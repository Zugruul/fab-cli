#!/usr/bin/env node
// Use tsx to run TypeScript directly — no build step needed
// tsx's public "./cjs/api" export (not a raw "../node_modules/tsx/dist/..."
// path into its internals) so this resolves whether tsx lives in
// fab-cli/node_modules (isolated pnpm linker) or is hoisted to the monorepo
// root's node_modules (fab-app's RN tooling needs the workspace-root
// "hoisted" linker — see ../../.npmrc).
const { register } = require("tsx/cjs/api");
register();
require("../src/cli.ts");
