---
tags: [briefs, conventions, cli]
paths: ["pipeline/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When a brief names a specific file to extend, read that file's actual shape before planning around it. APP-025's brief said 'extend pipeline/src/cli.ts' but that file is a single-purpose entry point, not a subcommand dispatcher — the repo convention is one cli.ts per concern. Matching the real convention beat following the brief's literal wording; verifying up front avoids a redesign pass.
