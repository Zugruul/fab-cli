# Design — fab/E1: CLI decomposition & UX

Grounded in: SPEC §2 (G2), §5, §6.4, §9.6.

## Components

- `src/commands/fabrary.ts` — registers the `fabrary` namespace: `auth`, `login`, `heroes`, `formats`, `search`, `top`, `deck`, `meta`, `meta-shift`. Mounts `cards.ts`'s subtree under it.
- `src/commands/cards.ts` — registers the `fabrary cards` subcommand: `local`, `search`, `show`.
- `src/commands/fabtcg.ts` — registers the `fabtcg` namespace: `events`, `card`, `coverage`.
- `src/commands/rules.ts` — registers the `rules` namespace: `update-docs` (grows with E2's `sync`/`search`/`show`/`ask`).
- `src/commands/lore.ts` — registers the `lore` namespace: `sync`, `search`, `show`, `list`.
- `src/commands/priceComparison.ts` — registers the `price-comparison` namespace: `card`, `export`. Owns the `buildCardCommandDeps`/`buildExportCommandDeps` factories currently inlined in `cli.ts`.
- `src/http.ts` (FAB-011, not yet created) — shared fetch helper: browser headers, retry/backoff, bounded concurrency (AppSync ≤4, fabtcg ≤5), opt-in TTL file cache under `~/.cache/fab-cli/`. Consumed by `fabtcg.ts`/`meta.ts` once FAB-011 lands; out of scope for FAB-010.
- `src/cli.ts` — shrinks to wiring only: construct `program`, call each `register*(program)`, `program.parseAsync(process.argv)`.

## Data models

None new. This epic is a pure command-registration split; all business logic keeps living in the existing service modules (`algolia.ts`, `graphql.ts`, `fabtcg.ts`, `meta.ts`, `cardvault.ts`, `pricing/*`, …), imported unchanged by the new command modules.

## Interfaces / contracts

- Every `src/commands/<namespace>.ts` exports `register<Namespace>(program: Command): Command`, where `program` is the root Commander instance (or, for `cards.ts`, the already-mounted `fabrary` command it attaches to). The returned value is the namespace's own `Command` node, mirroring the existing local-variable pattern in `cli.ts` (e.g. `const fabrary = program.command("fabrary")...`) so nested registration (`cards.ts` called from `fabrary.ts`) composes the same way it does today.
- No command name, flag, alias, argument shape, or help text may change as part of this split — the split is a pure code-motion refactor.
- `--json` (FAB-012) and the shared HTTP layer (FAB-011) are separate tasks layered on top of this module boundary; FAB-010 must not anticipate their shape beyond leaving normal room for a future global option/middleware on `program`.

## Key sequences

1. `bin/fab.js` requires `src/cli.ts`. `cli.ts` builds `const program = new Command()`, sets name/description/version, then calls `registerFabrary(program)`, `registerFabtcg(program)`, `registerRules(program)`, `registerLore(program)`, `registerPriceComparison(program)` in that fixed order (matching current registration order in `cli.ts` today), then `program.parseAsync(process.argv).catch(...)`.
2. `registerFabrary(program)` creates the `fabrary` subcommand, attaches its own leaf commands, then calls `registerCards(fabrary)` to mount `fabrary cards ...` before returning.
3. Zero-behavior-change proof (SPEC §6.4): a snapshot test captures `--help` output — root command and every subcommand, recursively — from `main` **before** the split lands, then asserts the split `cli.ts` produces byte-identical output for the same set of invocations. This is the task's acceptance test, not a manual check.

## Decisions

- **Split boundary = existing top-level Commander namespace** (`fabrary`, `fabtcg`, `rules`, `lore`), plus `cards` broken out separately per SPEC §5's explicit list, plus `price-comparison` (a real top-level namespace not named in SPEC §5's parenthetical list but architecturally identical — leaving it in `cli.ts` would violate "cli.ts becomes wiring" and defeat the point of the split).
- **Registration function shape**: plain `(program: Command) => Command`, no class/DI ceremony — matches the existing idiom already used inline in `cli.ts` (`program.command("fabrary")...`), so the diff is mechanical code motion rather than a redesign.
- **Zero behavior change is enforced by an automated `--help` snapshot test**, not eyeballing — this is what SPEC §6.4 actually requires ("byte-identical `--help` output... SHALL").
- **Shared inline helpers move with their sole consumer**: `buildCardCommandDeps`/`buildExportCommandDeps` move into `priceComparison.ts` (their only caller). The generic `int` parseInt helper is small enough to inline at each remaining call site or live in a tiny shared `src/commands/util.ts` if reused 3+ times — dev agent's call, zero behavior change either way.

## Out of scope for this epic

- FAB-011 (shared `src/http.ts`) and FAB-012 (`--json` flag) are separate E1 tasks; this doc's Components section stakes out `http.ts`'s eventual shape so FAB-010 doesn't box it in, but FAB-010 itself touches no HTTP/output-format code.
- Rules KB behavior (E2), player/judge brains (E3), live-follow polling (E4), and `--json` snapshot content (FAB-012) are unaffected by this split — only *where* their future command registration lives.
