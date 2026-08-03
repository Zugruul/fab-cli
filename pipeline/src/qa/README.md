# Teacher Q&A generation (SPEC-APP.md §7.3, issue #223)

Generates grounded Q&A training pairs per corpus chunk using a teacher model, via a resumable,
rate/cost-controlled batch runner. This directory's tests never call a real teacher transport —
see `test/qa.helpers.ts`'s `makeMockTeacher`/`fixtureSpawnFn` for the injectable mocks the whole
suite runs against.

## Files

- `types.ts` — shared types: `TeacherClient`/`TeacherRequest`/`TeacherResponse`, `EngineId`,
  `GenerationConfig`, `ProgressState`, `RunResult`.
- `prompt.ts` — pure `(chunk, config) -> {system, user}` prompt construction.
- `teacher.ts` — `AnthropicTeacherClient`: the Claude API transport (`anthropic-api` engine).
- `claudeCodeTeacher.ts` — `ClaudeCodeTeacherClient`: the Claude Code headless transport
  (`claude-code-subscription` engine, the default — see "Engines" below).
- `engine.ts` — `EngineId`/`DEFAULT_ENGINE_ID`/`buildTeacherClient()`: which transport a run uses.
- `parse.ts` — robust parse-with-repair of a teacher response into accepted/rejected pairs.
- `retry.ts` — generic bounded exponential-backoff retry (429/5xx by default), transport-agnostic.
- `runner.ts` — resumable, rate/cost-controlled batch runner (`runBatch`) over any `TeacherClient`.
- `pairsStore.ts` — durable, chunk_id-deduped persistence of accepted pairs.
- `manifest.ts` — per-run manifest (engine id, teacher model id, config hash, counts, cost).
- `review.ts` — human-reviewable markdown table of a run's outcomes.
- `cli.ts` — `qa:generate`: the real batch-generation entry point.
- `smoke.ts` — `qa:smoke`: OPTIONAL live smoke test (see below).

## Engines

Two `TeacherClient` implementations exist, selected by `EngineId`:

| Engine id                   | Transport                                    | Cost                                   |
|------------------------------|-----------------------------------------------|-----------------------------------------|
| `claude-code-subscription` (**default**) | Spawns the local `claude -p` headless CLI | Rides the user's Claude subscription, no metered API key |
| `anthropic-api`               | `@anthropic-ai/sdk`'s `Anthropic` client       | Billed per token via `ANTHROPIC_API_KEY` |

**`claude-code-subscription` is `DEFAULT_ENGINE_ID` and is never auto-selected away from just
because `ANTHROPIC_API_KEY` happens to be set in the environment.** Switching to `anthropic-api`
is always an explicit choice:

```bash
npm run qa:generate -- --engine anthropic-api      # CLI flag (highest precedence)
```

or by setting `"engine": "anthropic-api"` in the committed `config/qa-generation.json` (used when
no `--engine` flag is given). Precedence, implemented in `cli.ts`'s `resolveEngineId`:
**`--engine` flag > `config.engine` > `DEFAULT_ENGINE_ID`.**

The resolved engine id is recorded in every run's `manifest.json` (`engineId` field, alongside
`teacherModel`) — a shipped dataset's full generation lineage (model AND transport) is always
auditable from its manifest alone, per SPEC-APP.md §13 invariant 7.

### `ClaudeCodeTeacherClient` — flag choices

Verified live against the installed `claude` binary (`claude --help`, plus live `claude -p ...
--output-format json` calls) before implementation:

```
claude -p "<user prompt>" \
  --output-format json \
  --model <model> \
  --system-prompt "<system prompt>" \
  --tools "" \
  --setting-sources ""
```

- **`-p <user>`** — the positional prompt, `TeacherRequest.user`.
- **`--output-format json`** — a single JSON result object on stdout (not `stream-json`).
- **`--model <model>`** — `TeacherRequest.model` passed straight through.
- **`--system-prompt <system>`** — **full replacement** of the default system prompt, not
  `--append-system-prompt`. `TeacherRequest.system` is already a complete instruction set (see
  `prompt.ts`); appending it to Claude Code's own default interactive-agent system prompt would
  just add irrelevant instructions to every call. (`--append-system-prompt` exists and was
  considered — full replacement is the correct choice here, not a fallback for a missing flag.)
- **`--tools ""`** — disables the built-in tool set. A teacher call is pure text generation; no
  tool use is ever needed, and leaving tools enabled bloats every call with the built-in tool
  schema. Live comparison on a trivial prompt: **~23,500 input tokens with tools enabled vs.
  ~180 with `--tools ""`.**
- **`--setting-sources ""`** — disables CLAUDE.md / project-settings auto-discovery. Without
  this, running the pipeline from inside this monorepo pulls fab-cli's own (large,
  FAB-CLI-specific) `CLAUDE.md` into every single teacher call's context — irrelevant to Q&A
  generation and a further large, unnecessary cost. Confirmed live: even with `--tools ""` and a
  custom `--system-prompt`, cwd-based CLAUDE.md discovery alone still added ~25k input tokens
  until `--setting-sources ""` was added.

**Response mapping** — the real `--output-format json` result carries many more fields than
`TeacherResponse` has a home for (`total_cost_usd`, `duration_ms`, `session_id`, cache-token
breakdowns, ...). Only these are mapped:

```json
{
  "is_error": false,
  "result": "<the model's text response>",
  "usage": { "input_tokens": 2, "output_tokens": 10, "...": "..." },
  "...": "cost/cache/timing/session fields — not mapped"
}
```

- `result` → `TeacherResponse.text`
- `usage.input_tokens` / `usage.output_tokens` → `usage.inputTokens` / `usage.outputTokens`
  (zeroed if `usage` is absent from the response — documented, not fabricated; see
  `test/fixtures/fake-claude-happy-no-usage.mjs`)

**KNOWN LIMITATION — `usage.inputTokens` (and therefore `runner.ts`'s cost ceiling) is not a
reliable usage/cost gauge under this engine.** Claude Code's real `--output-format json` output
also carries `cache_creation_input_tokens` / `cache_read_input_tokens` fields — on a call that
hits this monorepo's prompt caching, those dominate the real context processed, but
`ClaudeCliResult` (this client's mapping) does not read them into `usage.inputTokens`, which
reflects only the NEW, non-cached input for that turn. Live-observed: a real call returned
`usage.input_tokens: 2` (see the earlier flag-rationale section) while the actual context
processed was in the thousands. Since `runner.ts`'s `estimateCost`/`cost.ceilingUsd` gate is
computed purely from `usage.inputTokens`/`outputTokens`, **the cost ceiling under
`claude-code-subscription` will under-count and may never trip even as real subscription usage
accrues.** This is a documented gap, not a bug fixed in this change — no change was made to the
mapping or to `runner.ts`; `anthropic-api`'s usage accounting is unaffected (it never routes
through this client). If accurate cost accounting under the subscription engine is needed later,
it requires either reading the cache-token fields into a new accounting path or tracking
`total_cost_usd` (also present in the real response but currently unmapped) separately.

**Error mapping** — every CLI failure raises `ClaudeCliError` with an optional `status`:

- A clean structured error body (e.g. an invalid `--model` — observed live: exit 1,
  `{"is_error": true, "api_error_status": 404, "result": "There's an issue with the selected
  model..."}`) → `status` = the CLI's own `api_error_status` (non-retryable for a bad model —
  retrying can never fix it).
- A rate-limit/subscription-usage-limit failure has no documented structured shape — it can fail
  before the CLI ever emits `--output-format=json` at all (plain-text stderr, nonzero exit). In
  that case a **synthetic `status: 429`** is inferred from a rate-limit-shaped message
  (`/rate.?limit|usage limit|overloaded|try again (later|in)|quota exceeded/i` over the CLI's
  `result` field or raw stdout/stderr). This is enough for `retry.ts`'s **unmodified** default
  `isRetryable` (429 or 5xx) to treat it as retryable — no changes to `retry.ts` were needed.
- Malformed/unparseable stdout on a `0` exit, or a spawn failure (binary not found), raise
  `ClaudeCliError` with no `status` — non-retryable, since retrying a code bug or a missing
  binary can't help.

### Pacing + resume

`ClaudeCodeTeacherClient` adds no new pacing/resume logic — it plugs into the existing
`runner.ts` (resumable batching, cost ceiling, concurrency, rate limiting) and `retry.ts`
(bounded exponential backoff) exactly like `AnthropicTeacherClient` always has. A subscription
rate-limit failure gets retried (bounded, per `config.maxRetries`/`retryBaseDelayMs`) via the
synthetic-429 mapping above; once retries are exhausted the chunk is recorded failed in
`progress.json` and a later `qa:generate` invocation resumes without re-attempting it. See
`test/qa.claudeCodeTeacher.pacing.test.ts` for the hermetic proof (scripted fake `claude`
binaries — retry-then-recover, and a failed chunk surviving a second `runBatch` call without a
further CLI invocation).

**The `cost.ceilingUsd` half of "cost/rate-controlled batch runner" does NOT function as a real
usage gauge under `claude-code-subscription`** — see the KNOWN LIMITATION under "Response
mapping" above: `usage.inputTokens` excludes cache-token fields, so the accumulated
`costUsd`/ceiling check in `runner.ts` under-counts real usage and may never trip. Concurrency
and requests-per-minute pacing are unaffected (they don't depend on token counts). Rely on the
Claude subscription's own usage limits (surfaced as retryable rate-limit failures, handled
above) rather than `cost.ceilingUsd` for budget control while running this engine.

## Live smoke test (optional, NOT part of the gate)

`npm run gate` never makes a network call (SPEC-APP.md §13 invariant 10) — every test in this
suite runs against a mock `TeacherClient` or a scripted fake `claude` binary, never the real
transport. To confirm an engine is actually wired up correctly against the real thing, run the
smoke script by hand:

```bash
npm run qa:smoke                          # claude-code-subscription (default) — real `claude -p`
npm run qa:smoke -- --engine anthropic-api  # real Claude API, requires ANTHROPIC_API_KEY
```

This makes exactly ONE real teacher call against a tiny hardcoded chunk (no corpus export
needed) and prints the resulting pair, token usage, and estimated cost. It is cheap (one short
Q&A generation call) but it is a real call — never run it from CI or the gate.
