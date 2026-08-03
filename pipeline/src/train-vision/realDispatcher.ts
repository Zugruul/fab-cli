/**
 * Vision-training dispatch reuses training/realDispatcher.ts's argv
 * builders and RealDispatcher class verbatim, exactly like export/
 * realDispatcher.ts already does for the export-gguf capability job. The
 * remote-compute.py `run`/`job-status`/`job-pull` contract has zero
 * sft/dpo/vision-specific logic baked into it — buildRunArgv/
 * buildStatusArgv/buildPullArgv and RealDispatcher are already fully
 * generic over {resource, capabilityJob}; re-implementing them here would
 * just be copy-paste drift risk against the one real dispatch contract.
 *
 * Capability status (a decision this issue's brief didn't cover — see
 * README.md): unlike `slm-training:sft`/`slm-training:export-gguf`, there
 * is NO `vision-training` (or `slm-training:obb-*`) capability job
 * installed on any resource yet. This module is wired and tested exactly
 * as if there were — `capabilityJob` is just a string this layer passes
 * through — so a real remote dispatch is a capability-bundle addition in
 * development-skills (a separate repo, out of this PR's scope) away, not
 * a TS change.
 */
export { buildRunArgv, buildStatusArgv, buildPullArgv, RealDispatcher } from "../training/realDispatcher.js";
export type {
  RunArgvOptions,
  StatusArgvOptions,
  PullArgvOptions,
  RealDispatcherConfig,
  RemoteComputeArgvBase,
} from "../training/realDispatcher.js";
