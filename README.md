# fab-monorepo

Monorepo root for the FAB companion project:

- [`fab-cli/`](fab-cli/) — the FAB CLI (deck/card search, meta analysis, tournament coverage, price comparison)
- [`fab-app/`](fab-app/) — companion mobile app
- [`pipeline/`](pipeline/) — training/artifact pipeline

See each package's own README for usage. `pnpm -r run gate` runs every package's quality gate from the root.

## Remote compute (training) — new-machine preflight

Training/export/eval runs dispatch to a GPU machine through the generic
`remote-compute` engine + `slm-training` capability bundle (both in the
development-skills repo). **All machine-local state is gitignored** — the
user-level registry (`~/.remote-compute/`) and this repo's
`.claude/project.local.yaml` availability overlay — so a fresh clone or a new
machine must be set up once before any training dispatch works.

The engine + bundle come from the companion repo
**[Zugruul/development-skills](https://github.com/Zugruul/development-skills)** —
clone it anywhere (`git clone git@github.com:Zugruul/development-skills.git`)
and export `DS=<clone path>`; everything below refers to
`$DS/plugins/spec-workflow/scripts/`.

The full, verified runbook (prerequisites incl. the non-obvious ones like
`python3.12-dev` for triton's JIT, register → add-env → install-capability →
enable, mandatory smoke verification, day-to-day pipeline usage, and known
WSL gotchas) lives in the project skill:

- **[`.claude/skills/remote-compute-setup/SKILL.md`](.claude/skills/remote-compute-setup/SKILL.md)**
  — in a Claude Code session: `/remote-compute-setup`; it is equally readable
  as a human runbook.

Quick health check on an already-set-up clone: `.claude/project.local.yaml`
exists and `python3 $DS/plugins/spec-workflow/scripts/remote-compute.py list`
shows your machine — if either is missing, run the skill.

## Licensing

This is a monorepo with **per-package licensing** — there is no single repo-wide license:

- `fab-cli` — GPL-3.0-only
- `fab-app` — MIT
- `pipeline` — MIT

See [`LICENSE.md`](LICENSE.md) for the full breakdown and the GPL-isolation rule that keeps the
MIT, App-Store-bound packages (`fab-app`, `pipeline`) free of any dependency on the GPL-3.0
`fab-cli` package.
