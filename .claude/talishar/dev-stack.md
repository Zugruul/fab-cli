# Talishar Local Dev Stack

Last verified against upstream: 2026-07-18

Working reference for bringing up the vendored Talishar stack locally. See `CLAUDE.md`'s
"Vendoring layout" for how the three clones (`third_party/talishar`, `third_party/talishar-fe`,
`third_party/talishar-cardimages`) are bootstrapped as gitignored siblings — required, since the
backend's compose file mounts a sibling `../Talishar-FE` directory.

## Bootstrap

```bash
bash scripts/talishar-bootstrap.sh   # clones + fork/upstream remote setup, idempotent
```

See `contributing.md` for the fork contract this sets up (`origin` = user's fork, `upstream` =
Talishar org repo).

## Backend

`bash start.sh` at `` `third_party/talishar/start.sh` `` — copies
`HostFiles/RedirectorTemplate.php` to `HostFiles/Redirector.php` (a required, not-checked-in
per-install config file), seeds `HostFiles/GameIDCounter.txt`, creates a writable `Games/`
directory, then runs `docker compose up -d`.

### Compose services

From `` `third_party/talishar/docker-compose.yml` `` (4 services):

| Service | Image/build | Host port | Notes |
|---|---|---|---|
| `web-server` | built from `Dockerfile` | **8080** (`8080:80`) | Apache/PHP; mounts `.` + sibling `../Talishar-FE` (for ad-hoc `zzCardCodeGenerator.php` runs) + Xdebug/OPCache/APCu-tuning/Apache-perf config overlays; `depends_on: redis, mysql-server` |
| `mysql-server` | `mysql:lts` | — (internal) | database `fabonline`, seeded from `` `third_party/talishar/Database/` ``, `--max_connections=500` |
| `phpmyadmin` | `phpmyadmin:latest` | `5001` | points at `mysql-server` |
| `redis` | `redis:7.0` | `6382` (container-internal `6379`) | container name `app_redis`; env `REDIS_HOST="app_redis"`, `REDIS_ENABLED="true"` |

`web-server`'s environment also sets `METAFY_CLIENT_ID`/`METAFY_LOGIN_CLIENT_ID` (Metafy/Patreon
supporter-tier OAuth, per `` `third_party/talishar/CLAUDE.md` ``) and `MYSQL_ROOT_PASSWORD:
"secret"` (local-only credential, not production).

### Xdebug

Listens on port `9003` inside the container, configured via the mounted
`docker/docker-php-ext-xdebug.ini` overlay. `` `third_party/talishar/CLAUDE.md` ``'s "Ports" line
and `` `third_party/talishar/README.md` `` both document PHPStorm/VS Code `launch.json` setup
(`idekey` filtering).

## Frontend

`npm run dev` (Vite) in `third_party/talishar-fe`, default port `5173`. Proxy config in
`` `third_party/talishar-fe/vite.config.mts` `` forwards `/api`, `/APIs`, `/AccountFiles` to the
backend at `${VITE_BACKEND_URL:-localhost}:${VITE_BACKEND_PORT:-8080}` — matching `web-server`'s
published **8080**. See `frontend.md` for the state-flow side of this connection.

## Sibling-directory layout (load-bearing)

`docker-compose.yml`'s `web-server.volumes` mounts `../Talishar-FE` into the container, and the
card-image pipeline scripts assume `CardImages` is a sibling of `Talishar` too
(`` `third_party/talishar/README.md` ``: "It's important... to have Talishar-FE and CardImages
repositories located in the same directory as Talishar"). Don't nest or rename
`third_party/{talishar,talishar-fe,talishar-cardimages}` — `scripts/talishar-bootstrap.sh` and
`CLAUDE.md`'s "Vendoring layout" preserve this relationship deliberately.

## Card-image pipeline

`` `third_party/talishar-cardimages/scripts/downloadImages.js` `` fetches per-language card
metadata from the official `cards.fabtcg.com` search API (`composeInitialApiUrl`), downloads each
card's official image, and via `` `third_party/talishar-cardimages/scripts/utils/sharpHelper.js` ``
(`saveCardImage`, `resizeImage`) writes both a full-size and a square-cropped copy under
`media/{uploaded/public|missing}/{cardimages|cardsquares}/{language}/` (constants `CARD_IMAGES`,
`CARD_SQUARES`).
`` `third_party/talishar-cardimages/scripts/generateTranslatedCollections.js` `` handles reprint
sets, producing a JSON mapping from an original card ID to the reprint's collection ID.

**Never commit anything from inside these clones** — especially card images (copyrighted,
transient-only, §10 I3 of `SPEC-TALISHAR.md`). All three clones are gitignored
(`third_party/talishar*` in `.gitignore`).

## Known gotchas

- **`third_party/talishar-cardimages/README.md`'s clone URL is wrong** — it says `git clone
  https://github.com/Talishar/Card-Images` (hyphenated, capital "Images"), but the real repo is
  `Talishar/CardImages` (no hyphen), confirmed via `git -C third_party/talishar-cardimages remote
  -v`. The hyphenated URL 404s. Trust `CLAUDE.md`'s vendoring layout and the bootstrap script's
  `Zugruul/CardImages`/`Talishar/CardImages` remote pair instead.
- **The old README-vs-port discrepancy (8000 vs 8080) is stale and no longer reproducible.** As of
  this verification, `` `third_party/talishar/README.md` `` states no port at all, and
  `` `third_party/talishar/CLAUDE.md` `` already states the correct **8080**, matching
  `docker-compose.yml`'s `ports: ["8080:80"]` and `` `third_party/talishar-fe/vite.config.mts` ``'s
  `8080` default. If a future refresh finds the README diverging from `docker-compose.yml`/`.env`
  again, trust the compose file and `CLAUDE.md`, not the prose README.
- Rate-limit etiquette for CardImages/live image downloads: ≤2 concurrent requests against
  `talishar.net`/`images.talishar.net`; download only for cards actively being implemented, never
  bulk mirroring (`SPEC-TALISHAR.md` §11).

## Curated reference set

Sibling files: `architecture.md`, `card-recipe.md`, `decision-queue.md`, `frontend.md`,
`contributing.md`. Long-form narrative: `docs/TALISHAR-ARCHITECTURE.md`'s "Local Dev Stack" and
"Known Stale Upstream Docs" sections.
