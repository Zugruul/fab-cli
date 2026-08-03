---
tags: [claude-cli, headless, pipeline]
paths: ["pipeline/**"]
strength: 2
source: ""
learned-from: task 223 + retro
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Facts for driving `claude -p` programmatically (teacher engine, #223): (a) MUST pass `--tools ""` AND `--setting-sources ""` TOGETHER — either alone still leaves ~23-26k input tokens of context bloat (tool schemas / CLAUDE.md auto-discovery); with both, a trivial call is ~183 tokens. Not discoverable from --help, only live comparison. (b) `--output-format json`; on FAILURE the exit code is nonzero but stdout usually STILL carries the structured JSON error ({"is_error":true,"api_error_status":NNN,...}) — always try parsing stdout before falling back to stderr; subscription rate-limit failures emit NO JSON (plain stderr) — detect via conservative message-pattern regex mapped to synthetic 429. (c) usage.input_tokens is per-turn NEW input only — excludes cache_creation/cache_read tokens which dominate real cost; never build cost accounting on it. (d) every -p call shows a small claude-haiku side-entry in modelUsage (classifier/title-gen overhead) — expected. (e) `--system-prompt` fully replaces; spawn with argv-array (no shell) to avoid quoting breakage; expect ~2-4s latency even for trivial prompts — factor into pacing/timeouts. (f) Test pattern: inject a spawn fn running fixture .mjs scripts under process.execPath — real child processes through the real code path, never the real binary.
