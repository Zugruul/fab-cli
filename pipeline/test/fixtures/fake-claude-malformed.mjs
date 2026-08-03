#!/usr/bin/env node
// Fake `claude` that exits 0 (success) but writes non-JSON garbage to
// stdout — regression fixture for a response that doesn't parse even
// though the process itself "succeeded".
process.stdout.write("not json at all {{{");
process.exit(0);
