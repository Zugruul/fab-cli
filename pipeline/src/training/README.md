# Training runner (APP-020, SPEC-APP.md §8.1, issue #132)

Fine-tunes Qwen3 1.7B and Qwen3 0.6B via QLoRA (Unsloth): SFT then DPO, thinking mode
disabled, with a committed per-run manifest (hyperparams, seeds, base-model hash, and a
training-environment capture) — resumable if the driving process dies mid-run.

- `types.ts` — shared types (`TrainingRunSpec`, `TrainingRunManifest`, `RunState`, the
  injectable `TrainingDispatcher` interface).
- `configBuilder.ts` — pure `TrainingRunSpec` → slm-training bundle config JSON.
- `environment.ts` — pure assembly of the `TrainingEnvironment` manifest block from
  already-fetched facts (lockfile sha256, gpu-check.json, a structured cuda/driver input).
- `runner.ts` — `run()`/`resume()` orchestration over a `TrainingDispatcher`.
- `realDispatcher.ts` — the real dispatcher: shells to remote-compute.py's `run`/
  `job-status`/`job-pull` verbs against the `slm-training` capability bundle.
- `cli.ts` — `run`/`resume`/`status` subcommands (`npm run train --`).

## CUDA (primary) vs MLX

§8.1 says runs execute "on local hardware (CUDA primary, MLX supported)". This module
implements only the CUDA path, dispatched to the storm590x RTX 5090 via the generic
remote-compute `slm-training` capability bundle. **MLX (local Apple-silicon execution) is
not implemented** — this is a documented gap, not a silent omission. A future MLX path
would target the same `TrainingBundleConfig`/`TrainingDispatcher` surface defined in
`types.ts`: a local dispatcher that runs an MLX-based trainer directly instead of shelling
to a remote machine, consuming the same `TrainingRunSpec` and producing the same
`TrainingRunManifest` shape.
