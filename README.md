# fab-monorepo

Monorepo root for the FAB companion project:

- [`fab-cli/`](fab-cli/) — the FAB CLI (deck/card search, meta analysis, tournament coverage, price comparison)
- [`fab-app/`](fab-app/) — companion mobile app
- [`pipeline/`](pipeline/) — training/artifact pipeline

See each package's own README for usage. `pnpm -r run gate` runs every package's quality gate from the root.

## Licensing

This is a monorepo with **per-package licensing** — there is no single repo-wide license:

- `fab-cli` — GPL-3.0-only
- `fab-app` — MIT
- `pipeline` — MIT

See [`LICENSE.md`](LICENSE.md) for the full breakdown and the GPL-isolation rule that keeps the
MIT, App-Store-bound packages (`fab-app`, `pipeline`) free of any dependency on the GPL-3.0
`fab-cli` package.
