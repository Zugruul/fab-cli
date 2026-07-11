---
tags: [api, reverse-engineering, agents, pattern]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

Reverse-engineering an undocumented API goes fastest as a pincer: spawn a bundle-analysis agent (download the SPA's JS, grep for the API base, route fragments, and fetch-wrapper auth logic) AND invite the human to paste a captured browser request from DevTools. When the human's capture lands mid-flight, forward it to the running agent via SendMessage so it only has to close the remaining gaps (e.g. the detail route after search is known). Verify every guessed route with curl before believing it — naive path guesses usually 404 while the real path is something unguessable (a literal `card_id/` segment, a required trailing slash). Cf. [[test-minimal-headers-before-spoofing]].
