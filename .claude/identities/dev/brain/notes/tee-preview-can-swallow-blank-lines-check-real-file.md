---
tags: [shell, markdown, tooling]
paths: ["**"]
strength: 1
source: "PR#107 (TAL-020) dev retro"
graduated: false
created: 2026-07-18
---

When piping generated multi-section markdown (e.g. a dossier or report preview) through  or similar for terminal preview, blank lines between sections can get silently swallowed depending on the shell/pipe setup, making the preview look like one run-on paragraph even though the underlying file is correctly formatted. Don't trust a tee'd terminal preview as evidence of the file's real formatting -- read the actual file (cat/Read) to verify section breaks, especially before reporting a formatting issue.
