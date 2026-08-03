#!/usr/bin/env node
// Fake `claude` that rate-limits for the first FAKE_CLAUDE_FAIL_COUNT
// invocations, then succeeds — used to prove ClaudeCodeTeacherClient's
// errors are retried (bounded, per retry.ts's existing withRetry) rather
// than treated as a hard failure. Call count is tracked durably in
// FAKE_CLAUDE_STATE_FILE since each invocation is a fresh process.
import fs from "node:fs";

const stateFile = process.env.FAKE_CLAUDE_STATE_FILE;
const failCount = Number(process.env.FAKE_CLAUDE_FAIL_COUNT ?? "0");

let calls = 0;
try {
  calls = Number(fs.readFileSync(stateFile, "utf8"));
} catch {
  calls = 0;
}
calls += 1;
fs.writeFileSync(stateFile, String(calls));

if (calls <= failCount) {
  process.stderr.write("Error: rate limit exceeded, please try again later.\n");
  process.exit(1);
} else {
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      result: "FAKE_CLAUDE_FLAKY_RECOVERED",
      usage: { input_tokens: 50, output_tokens: 25 },
    }),
  );
  process.exit(0);
}
