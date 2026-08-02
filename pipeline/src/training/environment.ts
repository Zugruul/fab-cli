/**
 * Training-environment capture (APP-020, SPEC-APP.md §8.1: "a
 * training-environment capture (dependency lockfile hash, CUDA/driver
 * versions)"). Pure assembly only — this module never probes anything
 * itself; it turns already-fetched facts into the manifest's
 * TrainingEnvironment block.
 *
 * Inputs and where they really come from:
 *  - lockfilePath: the repo-root pnpm-lock.yaml. Hashed with real sha256 —
 *    the training env's dependency set is only meaningfully pinned by the
 *    lockfile that produced it.
 *  - gpuCheck: the slm-training:gpu-check capability job's real
 *    gpu-check.json output (development-skills/plugins/spec-workflow/
 *    scripts/remote-capabilities/slm-training/gpu_check.py) — torch
 *    version, device name, and unsloth version (or unslothError) come from
 *    here, parsed against that script's actual field names, not assumed.
 *  - cudaDriver: CUDA/driver versions are NOT in gpu-check.json (torch
 *    reports its own cuda build tag, not the host driver). The caller
 *    supplies a structured {cuda, driver} object from either (a)
 *    remote-compute.py's own resources.yaml registry snapshot for the
 *    resource (`<nick>.capabilities.gpu.{cuda,driver}`, itself populated by
 *    remote-compute.py's own `nvidia-smi --query-gpu=...` probe + its WSL2
 *    CUDA-version fallback parse), or (b) a caller-parsed raw nvidia-smi
 *    probe line in that same {cuda, driver} shape. This module accepts the
 *    already-structured object rather than parsing raw probe text itself —
 *    parsing stays with whichever side actually ran the probe.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { TrainingEnvironment } from "./types.js";

/** gpu_check.py's real gpu-check.json shape. Only torch/device/unsloth
 * feed the manifest's environment block (see assembleEnvironment below);
 * archList/vramTotalMB/vramFreeMB/matmulMs/matmulChecksum/cudaAvailable are
 * modeled here (so a caller can pass the artifact through unmodified) but
 * intentionally unused by this module. */
export interface GpuCheckArtifact {
  torch?: string;
  cudaAvailable?: boolean;
  device?: string;
  archList?: string[];
  vramTotalMB?: number;
  vramFreeMB?: number;
  matmulMs?: number;
  matmulChecksum?: number;
  unsloth?: string;
  unslothError?: string;
}

export interface CudaDriverInfo {
  cuda: string | null;
  driver: string | null;
}

export interface EnvironmentInputs {
  lockfilePath: string;
  gpuCheck: GpuCheckArtifact;
  cudaDriver: CudaDriverInfo;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function assembleEnvironment(inputs: EnvironmentInputs): TrainingEnvironment {
  return {
    lockfileSha256: sha256File(inputs.lockfilePath),
    torch: inputs.gpuCheck.torch ?? null,
    cuda: inputs.cudaDriver.cuda,
    driver: inputs.cudaDriver.driver,
    gpu: inputs.gpuCheck.device ?? null,
    // unslothError (present when the training env wasn't fully active at
    // probe time — see gpu_check.py's own doc comment) means "unknown",
    // never a fabricated version string.
    unsloth: inputs.gpuCheck.unsloth ?? null,
  };
}
