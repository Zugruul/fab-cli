---
tags: [review, testing, invariants]
paths: ["test/**", ".claude/skills/**"]
strength: 1
source: "PR#111 (TAL-023) code-quality review"
graduated: false
created: 2026-07-18
---

When a structural test asserts a hard invariant is present via a regex match, a green test only proves the regex matched SOMEWHERE in the section -- not that the invariant is stated at the specific step where an agent would actually be acting on it. A looser draft could satisfy the same regex with a throwaway incidental mention elsewhere in the same 800+ char blob a length-guard permits. After confirming the test is green, manually re-read the matched section in context to confirm the invariant lands where it actually bites (the concrete step that could violate it), not just present somewhere in the document.
