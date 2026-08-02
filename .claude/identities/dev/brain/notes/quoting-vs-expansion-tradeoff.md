---
tags: [shell, escaping, remote, security]
paths: []
strength: 1
source: "PR #213 rounds 2-3 (tilde regression)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Escaping and shell expansion are a direct tradeoff: single-quoting a token makes every metacharacter inert AND disables tilde/parameter expansion — so 'escape everything' broke the documented ~/.venv/bin/python3 invocation the moment it was properly quoted (a quoted ~ is a literal filename char in every POSIX shell). The working pattern for untrusted-ish path tokens that must still resolve: emit the fixed literal ~/ prefix unquoted and single-quote-escape ONLY the remainder (never any caller-controlled byte outside quotes), falling through to full quoting for non-tilde tokens. Generalizes to any 'sanitize then execute remotely' surface: decide per token which shell features must still WORK, quote everything else, and verify with a live shell — not by eyeballing the string.
