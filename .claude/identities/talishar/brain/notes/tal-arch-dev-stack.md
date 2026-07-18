---
tags: [talishar, architecture, dev-stack, docker]
paths: []
strength: 1
source: "third_party/talishar/docker-compose.yml; third_party/talishar/start.sh; third_party/talishar-fe/vite.config.mts; third_party/talishar/README.md"
graduated: false
created: 2026-07-18
---

Backend: `bash start.sh` (`third_party/talishar/start.sh`) copies
`HostFiles/RedirectorTemplate.php` to `HostFiles/Redirector.php` (a required, not-checked-in
per-install config file), seeds `HostFiles/GameIDCounter.txt`, creates a writable `Games/`
directory (the file-based state store — see [[tal-arch-gamefile-lifecycle]]), then runs `docker
compose up -d`. `third_party/talishar/docker-compose.yml` defines four services:

- `web-server` — Apache/PHP on host port **8080** (`ports: ["8080:80"]`); mounts the current
  directory plus a sibling `../Talishar-FE` (for ad-hoc `zzCardCodeGenerator.php` runs) and
  Xdebug/OPCache/APCu-tuning/Apache-performance config overlays; `depends_on: redis,
  mysql-server`. Environment also sets `METAFY_CLIENT_ID`/`METAFY_LOGIN_CLIENT_ID` and
  `MYSQL_ROOT_PASSWORD: "secret"` (local-only, not production).
- `mysql-server` — `mysql:lts`, database `fabonline`, seeded from `third_party/talishar/Database/`,
  `--max_connections=500`.
- `phpmyadmin` — host port `5001`, points at `mysql-server`.
- `redis` — host port `6382` (container-internal `6379`), container name `app_redis`.

Xdebug listens on port `9003` inside the container, configured via a mounted
`docker/docker-php-ext-xdebug.ini` overlay.

Frontend: `npm run dev` (Vite) in `third_party/talishar-fe`, default port `5173`. That config's
`server.proxy` block forwards `/api`, `/APIs`, `/AccountFiles` to
`http://${VITE_BACKEND_URL:-localhost}:${VITE_BACKEND_PORT:-8080}/${VITE_BACKEND_DIRECTORY:-game}`
— i.e. defaults to the same **8080** the backend's compose file publishes, so the two repos agree
on the port without a shared hardcoded constant.

**Sibling-directory layout is load-bearing, not cosmetic**: `docker-compose.yml`'s
`web-server.volumes` mounts `../Talishar-FE` into the container, and the card-image pipeline scripts
assume `CardImages` is a sibling of `Talishar` too (`third_party/talishar/README.md`: "It's
important... to have Talishar-FE and CardImages repositories located in the same directory as
Talishar"). fab-cli's vendoring under `third_party/{talishar,talishar-fe,talishar-cardimages}`
preserves this deliberately — don't nest or rename these directories.

See [[tal-dev-bootstrap]] for setting this up from scratch and [[tal-dev-gotchas]] for known
doc-vs-reality drift (a stale port-8000 claim, a wrong CardImages clone URL).
