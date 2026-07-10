---
tags: [brains, tooling, pitfall]
paths: []
strength: 1
source: "loop-feedback 2026-07-10"
graduated: false
created: 2026-07-10
---

Minting registers a note's wikilinks ONLY from the body present at mint time. Two workflows silently desynchronize links.json: minting a stub then appending the body, and generating note files directly (bulk ingestion). After EITHER, rebuild links.json by scanning all note bodies for [[targets]] (add missing keys with default weight; never reset existing weights/fires) — otherwise the notes look fine on disk but have no synapses. Also guard every mint call in a batch (one hung mint killed a whole heredoc pipeline and left a file missing) and verify expected files exist after the batch. See [[scripted-knowledge-ingestion]].
