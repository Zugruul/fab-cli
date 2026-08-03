# Model export chain (APP-021, SPEC-APP.md §8.2, issue #133)

Exports a merged GGUF per tier, quantizes (Q4_K_M primary, Q8_0 reference), and smoke-tests
each artifact in llama.cpp (load + one JSON-schema-constrained completion) before it's
eligible for packaging — with a committed per-run manifest (checksums + licenses) —
resumable if the driving process dies mid-run. The unmerged LoRA adapter stays a pipeline
artifact only; it is never shipped (§5).

- `types.ts` — shared types (`ExportRunSpec`, `ExportRunManifest`, `ExportRunState`).
  Reuses training/types.ts's `ModelTier`/`BASE_MODEL_BY_TIER`/`TrainingEnvironment`/
  `TrainingDispatcher` rather than re-deriving them — §8.2 exports the same base model the
  §8.1 run trained against, and the remote dispatch contract has no export-specific shape.
- `configBuilder.ts` — pure `ExportRunSpec` → slm-training `export-gguf` bundle config JSON,
  including the smoke section (prompt, JSON schema, max tokens, optional llama-server override —
  `llama-cli` is a deprecated alias, see below).
- `licenses.ts` — pure `ExportLicenses` assembly (base model, adapters, GGUFs) for the
  manifest — see its doc comments for the reasoning behind each recorded value.
- `runner.ts` — `run()`/`resume()` orchestration over an `ExportDispatcher`. Resolves the
  adapters source (a training run's committed manifest, a local dir, or neither for a
  base-as-is export), dispatches, polls, pulls `gguf/` + `export-summary.json`, and writes
  the manifest. **Deliberately diverges from training/runner.ts**: a failed job still pulls
  artifacts once, because export_gguf.py records per-file smoke diagnostics into
  `export-summary.json` before exiting nonzero on a smoke failure — see the module's doc
  comment for the full rationale.
- `realDispatcher.ts` — re-exports training/realDispatcher.ts's argv builders and
  `RealDispatcher` verbatim (targeting `slm-training:export-gguf`): the remote-compute.py
  dispatch contract has no sft/dpo/export-specific logic, so it's reused rather than
  duplicated.
- `cli.ts` — `run`/`resume`/`status` subcommands (`npm run export-model --`).

## Run dirs

`export-runs/<runId>/` holds `config.json` + `state.json` + `manifest.json` (all committed)
plus a gitignored `gguf/` pulled from the remote job (see `export-runs/.gitignore`).

## Smoke vehicle: llama-server, not llama-cli (issue #221)

The remote `export_gguf.py` (slm-training capability bundle, `development-skills` repo) smoke-
tests each produced GGUF via **llama-server's HTTP API** — start the server on a free localhost
port, poll `/health` until ready, `POST /completion` with `{prompt, json_schema, n_predict,
temperature: 0}`, validate `content` parses as JSON conforming to the schema, then always
terminate the server. This replaced a direct `llama-cli` invocation after issue #221's diagnostic
on storm590x reproduced two llama-cli bugs identically across three independent builds: a
grammar-sampler init failure on `--json-schema`/`--json-schema-file`, and (once routed around via
`--grammar-file`) an infinite interactive `"> "` REPL prompt despite `-no-cnv` and stdin at EOF.
llama-server has no in-process grammar-sampler init path and no interactive REPL, so both failure
modes are structurally avoided — and a bounded `/health` poll plus an always-terminate `finally`
means a hung/never-ready server can never hold the shared GPU resource lock, unlike the old
busy-loop.

This is **not a spec delta**: SPEC-APP.md §8.2 says "smoke-test each artifact in llama.cpp" —
llama-server ships in the same llama.cpp build as llama-cli, so the contract is unchanged; only
the vehicle within llama.cpp changed.

- `SmokeConfig.llamaServer` / `--llama-server <path>` — optional override of the llama-server
  binary path on the remote machine (bundle config key `smoke.llama_server`). Falls back to
  `export_gguf.py`'s own discovery order (working dir + `$HOME`, searching `llama.cpp*` dirs for
  `build/bin/llama-server`/`build/bin/server`/`llama-server`/`server`) when omitted.
- `SmokeConfig.llamaCli` / `--llama-cli <path>` — **deprecated**, still accepted. When
  `llama_server` is absent, `export_gguf.py` derives the server binary from `llama_cli`'s
  directory (both binaries ship from the same `build/bin/`) and logs a deprecation warning
  remotely. Prefer `--llama-server` for new configs.
- The `SmokeFileResult` contract (`file`, `loaded`, `constrainedOutputRaw`, `parsedOk`) is
  unchanged — `loaded` now means "the server became healthy" rather than "the CLI process exited
  0", and `constrainedOutputRaw` is the HTTP response's `content` field instead of CLI stdout.
