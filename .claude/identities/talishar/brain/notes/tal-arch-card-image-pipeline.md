---
tags: [talishar, architecture, card-images]
paths: []
strength: 1
source: "third_party/talishar-cardimages/scripts/downloadImages.js; third_party/talishar-cardimages/scripts/utils/sharpHelper.js; third_party/talishar-cardimages/scripts/generateTranslatedCollections.js; third_party/talishar-fe/scripts/card-generator.js; third_party/talishar-fe/src/appConstants.ts"
graduated: false
created: 2026-07-18
---

Card art flows through `third_party/talishar-cardimages` (upstream `Talishar/CardImages`) before
either the engine or FE touches it. `scripts/downloadImages.js` fetches per-language card metadata
from the official `cards.fabtcg.com` search API (`composeInitialApiUrl`), downloads each card's
official image, and — via `scripts/utils/sharpHelper.js` (`saveCardImage`, `resizeImage`) — writes
both a full-size copy and a square-cropped copy under
`media/{uploaded/public|missing}/{cardimages|cardsquares}/{language}/` (constants `CARD_IMAGES`,
`CARD_SQUARES` in that same script). `scripts/generateTranslatedCollections.js` handles reprint sets
(e.g. new History Packs): produces a JSON mapping from an original card ID to the reprint's
collection ID, consumed by the FE for multi-language display.

On the FE side, `third_party/talishar-fe/package.json`'s `generate-cards` script (`node
scripts/card-generator.js && npx prettier --write src/constants/cardList.ts`) regenerates
`src/constants/cardList.ts` — the authoritative list of playable card *names* — by fetching
`https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/main/json/english/card.json`
directly, the same the-fab-cube dataset `zzCardCodeGenerator.php` consumes on the backend (see
[[tal-arch-card-object-model]]) — one shared upstream source feeds both the FE's
autocomplete/search list and the backend's generated card stats. A sibling `generate-keywords`
script regenerates keyword/CR-text data similarly.

**CDN naming**: the FE serves card art from `https://images.talishar.net/public`
(`third_party/talishar-fe/src/appConstants.ts` line 5, `CLOUD_IMAGES_URL`), mirroring the same
`cardimages`/`cardsquares` + language + filename layout `downloadImages.js` writes locally — the
local `media/` tree and the CDN mirror the same relative path structure.

Never mirror this pipeline's downloads in bulk locally, and never commit anything written into
`media/` — see [[tal-dev-gotchas]] for the operational rules (rate limits, gitignore status).
