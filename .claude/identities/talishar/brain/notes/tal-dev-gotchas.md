---
tags: [talishar, dev-tooling, gotchas, stale-docs]
paths: []
strength: 1
source: "third_party/talishar-cardimages/README.md; third_party/talishar/README.md; third_party/talishar/CLAUDE.md; third_party/talishar/docker-compose.yml; third_party/talishar/DecisionQueue/DecisionQueueEffects.php"
graduated: false
created: 2026-07-18
---

Known drift points between vendored upstream docs and reality — don't act on the doc's word alone
without cross-checking:

- **`third_party/talishar-cardimages/README.md`'s clone URL is wrong.** Its "Requirements / How to
  install" section says `git clone https://github.com/Talishar/Card-Images` (hyphenated, capital-C
  "Images") — 404s. The real repo, confirmed via `git -C third_party/talishar-cardimages remote
  -v`, is `Talishar/CardImages` (no hyphen). Trust fab-cli's own `CLAUDE.md` vendoring layout and
  `scripts/talishar-bootstrap.sh`'s `Zugruul/CardImages`/`Talishar/CardImages` remote pair instead.

- **If you see "port 8000" mentioned for the backend anywhere, ignore it.** That was a stale README
  claim that no longer exists in the current vendored clone: `third_party/talishar/README.md`
  currently states no port at all, and `third_party/talishar/CLAUDE.md` already gives the correct
  **8080**, matching `docker-compose.yml`'s `ports: ["8080:80"]` and the FE's `vite.config.mts`
  default (see [[tal-arch-dev-stack]]). Should a future README drift again, trust
  `docker-compose.yml`/`CLAUDE.md` over prose README claims.

- **Rate-limit etiquette toward upstream infra**: cap concurrent requests against
  `talishar.net`/`images.talishar.net` at 2, and only pull card images
  ([[tal-arch-card-image-pipeline]]) for cards actively being implemented — never bulk-mirror.

- **No formal `CONTRIBUTING.md` upstream** — don't go looking for one; process conventions live in
  `third_party/talishar/CLAUDE.md`/`New Developer Guide.md` and the project Discord instead (see
  [[tal-arch-contribution-conventions]]).

- **Not all card logic lives in a `Card` subclass.** `third_party/talishar/DecisionQueue/
  DecisionQueueEffects.php`'s `SpecificCardLogic($player, $card, $lastResult, $initiator)`
  (line 504) is a 958-line switch/dispatch function (verified via brace-depth tracking: the
  function body runs exactly from line 504 to line 1461) that predates the [[tal-arch-card-object-model]] `Card`-subclass pattern and
  still coexists with it, handling card logic for cards never migrated to that pattern. If you're
  implementing or fixing a card and can't find its logic in `Classes/CardObjects/{SET}Cards.php`,
  check `SpecificCardLogic()` before assuming the card has no implementation at all.

This note is a living punch-list, not a closed set — per SPEC-TALISHAR.md §7.6, future
`/talishar-fork-sync` runs and card-implementation sessions are expected to keep adding entries
here as new doc/reality drift is discovered.
