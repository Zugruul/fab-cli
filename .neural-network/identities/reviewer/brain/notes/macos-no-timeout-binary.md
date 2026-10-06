---
tags: [macos, bash, tooling]
paths: ["**"]
strength: 1
source: "PR#92 (TAL-002) reviewer retro"
graduated: false
created: 2026-07-18
---

macOS has no `timeout` binary by default — `timeout 10 cmd` silently fails to resolve and a probe can hang for the full tool timeout. Use `cmd & pid=$!; sleep N; kill $pid 2>/dev/null` instead for any probe script with unknown hang risk. Also: write multi-line/heredoc probe scripts to a file (Write tool) and `bash <file>` rather than inlining heredocs in a single Bash tool call — more reliable.
