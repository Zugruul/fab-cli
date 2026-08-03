#!/usr/bin/env node
// Fake `claude` reproducing a rate-limit-shaped failure with NO structured
// JSON body — a plain-text stderr message and a nonzero exit, which is
// what a subscription-usage-limit failure looks like when the CLI can't
// even reach the point of emitting --output-format=json. Always fails
// (see fake-claude-flaky.mjs for a "fails then recovers" variant used by
// the retry/pacing tests).
process.stderr.write(
  "Error: You have hit your Claude usage limit for this period. Please try again later.\n",
);
process.exit(1);
