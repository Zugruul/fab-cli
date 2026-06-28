#!/usr/bin/env node
// Use tsx to run TypeScript directly — no build step needed
const { register } = require("../node_modules/tsx/dist/cjs/api/index.cjs");
register();
require("../src/cli.ts");
