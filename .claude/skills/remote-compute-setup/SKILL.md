---
name: remote-compute-setup
description: Set up (or re-verify) a GPU machine for this project's remote training/export/eval dispatch — register it with remote-compute, provision the training env, install the slm-training capability, enable it for this repo, and smoke-verify — then teaches the day-to-day usage. Use when onboarding a new machine or a fresh clone ("set up remote compute", "register the GPU box", "training dispatch isn't set up here"), or when .claude/project.local.yaml is missing.
---

# Remote compute setup — training dispatch for this project

Everything machine-local lives OUTSIDE git: the user-level registry
(`~/.claude/compute/`) and this repo's `.claude/project.local.yaml` overlay
(gitignored). A fresh clone or a new machine therefore starts from zero — this
skill reconstructs the whole rail and verifies every step against the real
machine (never assume; every claim below came from a verified live run).

The generic engine + bundle live in the companion GitHub repo
**https://github.com/Zugruul/development-skills** — clone it first if this
machine doesn't have it (any location works):

```bash
git clone git@github.com:Zugruul/development-skills.git
export DS=<path-to-that-clone>
```

Inside it, `plugins/spec-workflow/scripts/` holds `remote-compute.py` (the
engine) and `remote-capabilities/slm-training/` (the config-driven
train/export/eval bundle — PROJECT-AGNOSTIC; project knowledge stays in this
repo's pipeline/ configs, and that agnosticism is test-enforced upstream.
Extending it = extending its generic config surface there).

Let `RC="python3 $DS/plugins/spec-workflow/scripts/remote-compute.py"`.

## 1. One-time GPU-machine prerequisites (human/sudo items — print, don't run)

On the machine (examples from storm590x, WSL2 Ubuntu 24.04 + RTX 5090):
- SSH key auth (`ssh-copy-id`), reachable alias in `~/.ssh/config`.
- A Python venv with CUDA torch + unsloth matched to the GPU generation
  (Blackwell/sm_120 needs the cu128 wheel index):
  `uv pip install --python ~/.venv/bin/python3 torch torchvision --index-url https://download.pytorch.org/whl/cu128`
  then `uv pip install unsloth` (torchvision must satisfy unsloth's floor).
- `python3.12-dev` (or the machine's python version's -dev package) — triton
  JIT-compiles its CUDA launcher against Python.h at the FIRST training
  kernel; without it training fails while plain matmuls still pass.
- Build toolchain `cmake make gcc g++` (llama.cpp smoke + unsloth's converter).
- `tmux` and `rsync`.
- Optional but recommended: a llama-cli build for the export smoke —
  `git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llama.cpp &&
  cmake -B ~/llama.cpp/build -S ~/llama.cpp -DGGML_CUDA=OFF -DLLAMA_CURL=OFF &&
  cmake --build ~/llama.cpp/build --target llama-cli -j 8`
  (CPU inference is sufficient for the constrained-completion smoke; the
  bundle auto-discovers `~/llama.cpp/build/bin/llama-cli`).

## 2. Register + provision (idempotent — safe to re-run to repair drift)

```bash
$RC register <nickname> <user@host>        # probes GPU/RAM/disks, converges ssh config; follow its NEEDS_* prompts
$RC add-env <nickname> training \
  --activate 'source ~/.venv/bin/activate' \
  --verify 'import torch, unsloth; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0), "unsloth", unsloth.__version__)'
$RC install-capability <nickname> $DS/plugins/spec-workflow/scripts/remote-capabilities/slm-training
$RC enable <nickname> --root <this-repo-root> --role training   # writes .claude/project.local.yaml (gitignored)
```

`enable`'s snapshot records cuda/driver — the pipeline CLIs REQUIRE those two
values on every `run` (§8.1 environment capture); read them from
`~/.claude/compute/resources.yaml`, never hand-type guesses.

## 3. Verify (mandatory — a setup that hasn't run a real job isn't set up)

```bash
$RC run <nickname> slm-training:gpu-check --job-id setup-check
$RC job-status setup-check && $RC job-logs setup-check
$RC job-pull setup-check --dest /tmp/setup-check   # expect gpu-check.json with cudaAvailable true + the GPU name
```

Then a 2-step tiny SFT (proves triton/unsloth end to end, ~1 min with the
model cached): author a tiny config (see `pipeline/test/fixtures/training/`
for row shapes) and dispatch `slm-training:sft` with it via `--inputs`.

## 4. Day-to-day usage (what this project actually runs)

The pipeline owns the orchestration; the bundle jobs are the transport:
- Training runs: `pipeline`'s `npm run train -- run --run-id <id> --tier 1.7B|0.6B --stage sft|dpo --dataset <path> --seed <n> --inputs <dir> --lockfile <pnpm-lock> --gpu-check <gpu-check.json> --cuda <v> --driver <v>` — dispatches `slm-training:sft`, polls, pulls adapters, writes the committed manifest under `pipeline/training-runs/<id>/`. `resume <id>` continues an interrupted run. Set `REMOTE_COMPUTE_PY` to the engine path.
- Export: `npm run export-model -- run --run-id <id> --tier <t> --adapters-dir <remote-abs-path>|--adapters-run-id <trainingRunId> ...` — GGUF per tier (q4_k_m+q8_0), llama.cpp constrained-completion smoke, licensed manifest under `pipeline/export-runs/<id>/`.
- Monitor on-machine: run development-skills' `compute-top` on the box.
- The GPU is shared: a dispatched job HOLDS the resource lock — that is
  intended. `job-status` releases it when the job is seen finished.

Known machine-class gotchas (all hit live, all recorded in the registry
probe): WSL `nvidia-smi` lives at `/usr/lib/wsl/lib/nvidia-smi` (not on
non-interactive PATH); remote default shell may be zsh (the engine wraps
commands itself — never hand-build ssh command strings); keep datasets and
checkpoints on ext4, never `/mnt/*` (DrvFs); WSL "RAM" is the VM's allotment.
