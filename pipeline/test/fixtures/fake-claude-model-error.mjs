#!/usr/bin/env node
// Fake `claude` reproducing a real, observed failure shape: an invalid
// --model value. Exits 1 with a clean JSON error body carrying
// api_error_status (captured live from `claude -p ... --model
// definitely-not-a-real-model --output-format json`). Non-retryable —
// retrying a bad model id can never succeed.
process.stdout.write(
  JSON.stringify({
    is_error: true,
    api_error_status: 404,
    result:
      "There's an issue with the selected model (fake-model). It may not exist or you may not have access to it.",
  }),
);
process.exit(1);
