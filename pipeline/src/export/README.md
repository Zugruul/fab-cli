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
  including the smoke section (prompt, JSON schema, max tokens, optional llama-cli override).
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
