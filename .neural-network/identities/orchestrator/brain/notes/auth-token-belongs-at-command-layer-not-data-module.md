---
tags: [auth, architecture, briefing]
paths: ["src/**"]
strength: 1
source: "PR#108 (FAB-050) — prep.ts's getValidToken() deviation, caught by code-quality review"
graduated: false
created: 2026-07-18
---

When a new command wraps a data-fetching function that needs auth, the correct pattern in this codebase is ALWAYS: keep the data module pure (no config.ts/getValidToken import — accept a token parameter instead) and wrap the call in commands/util.ts's callWithToken() at the command-action layer. A dev agent choosing to call getValidToken() directly inside a 'pure data module' seemed defensible in isolation but was the ONLY place in the whole codebase doing so — checking every other auth-needing data module (or lack thereof) before accepting a plausible-sounding architectural justification would have caught this before review.

Related: [[expose-internally-resolved-ids-dont-rederive]]
