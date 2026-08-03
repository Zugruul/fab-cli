#!/usr/bin/env node
// Fake `claude` that ALWAYS rate-limits — used by the resume test to prove
// that once a chunk exhausts retries and is recorded as failed in
// progress.json, a second runBatch invocation against the same
// progressPath never calls the CLI again for that chunk. Call count is
// tracked durably in FAKE_CLAUDE_STATE_FILE so the test can assert on it
// across two separate runBatch invocations.
import fs from "node:fs";

const stateFile = process.env.FAKE_CLAUDE_STATE_FILE;
let calls = 0;
try {
  calls = Number(fs.readFileSync(stateFile, "utf8"));
} catch {
  calls = 0;
}
calls += 1;
fs.writeFileSync(stateFile, String(calls));

process.stderr.write("Error: usage limit reached, try again later.\n");
process.exit(1);
