---
tags: [api, http, honesty, pattern]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

Before shipping spoofed browser headers in an API client, test the MINIMAL set: drop all headers and add back only what a real request needs. WAF-blocked HTML sites and their APIs often differ — one fabtcg.com property requires full browser headers while its API subdomain accepts requests with no headers at all. When the API is open, ship an honest identifying User-Agent (tool name + repo URL) instead of masquerading as Chrome: it's truthful, debuggable server-side, and avoids breaking when UA-sniffing changes. Spoofing is a last resort for endpoints that actually gate on it, not a default. Cf. [[api-reverse-engineering-with-human-capture]].
