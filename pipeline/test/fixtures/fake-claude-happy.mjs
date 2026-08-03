#!/usr/bin/env node
// Fake `claude -p ... --output-format json` happy path: emits a JSON body
// shaped like the real CLI's --output-format=json single-result output
// (verified against a live `claude -p ... --output-format json` call —
// see pipeline/src/qa/README.md for the full captured shape). Used by
// qa.claudeCodeTeacher.test.ts — never the real `claude` binary.
process.stdout.write(
  JSON.stringify({
    is_error: false,
    result: "FAKE_CLAUDE_HAPPY_RESULT",
    usage: { input_tokens: 111, output_tokens: 22 },
  }),
);
process.exit(0);
