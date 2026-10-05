---
tags: [php, engine, research, architecture]
paths: ["third_party/talishar/**"]
strength: 1
source: "PR#109 (TAL-021) dev retro"
graduated: false
created: 2026-07-18
---

Don't trust a hook/method's NAME to imply it's wired into the engine's actual resolution path for the target scenario -- verify by grepping who calls it and what it dispatches on. A hook can exist on a base class, read like a generic 'on X' handler, and still only be invoked from a narrower code path than its name suggests (e.g. a hook that reads as generic on-destroy but is only called from character-destroy paths, never item-destroy paths). Some behaviors aren't even implemented via a dedicated hook at all -- several real cards hardcode their condition inline in a shared engine file's switch statement instead. Both patterns look like a clean single-file implementation until you trace the actual call graph; tracing it BEFORE committing to an approach avoids discovering mid-implementation that you need shared-engine-file edits, a worse fit when a clean isolated diff matters.
