---
tags: [delegation, session, cleanup]
paths: []
strength: 1
source: "roster-ghost deadlock, session 703017a7 close"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

A context-clear does NOT clear the session's teammate roster: in-process agents from earlier conversation segments stay registered (the session id survives), read as active to any automation that trusts the roster, and are silently unreachable by guessed names. Segment-boundary hygiene: read the harness's own team config on disk (~/.claude/teams/session-<id>/config.json) for the EXACT member names — never guess naming patterns — and send shutdown_requests to every stale member; verify the roster drained afterwards. Batch fan-outs of shutdowns can trip API rate limits — space them and retry survivors. Surfaced upstream: the harness should auto-terminate teammates when their spawning segment ends.
