#!/usr/bin/env node
// Fake `claude` that succeeds (is_error: false, a real `result` string) but
// whose JSON body has NO `usage` field at all — a real observed shape gap
// (e.g. an older/degraded CLI response). Used to prove
// ClaudeCodeTeacherClient's documented zeroing behavior: usage absent ->
// {inputTokens: 0, outputTokens: 0}, never a crash and never a fabricated
// non-zero value.
process.stdout.write(
  JSON.stringify({
    is_error: false,
    result: "FAKE_CLAUDE_NO_USAGE_RESULT",
  }),
);
process.exit(0);
