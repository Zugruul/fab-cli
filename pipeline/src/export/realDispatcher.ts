/**
 * Export dispatch reuses training/realDispatcher.ts's argv builders and
 * RealDispatcher class verbatim, targeting the slm-training:export-gguf
 * capability job instead of :sft/:dpo. The remote-compute.py `run`/
 * `job-status`/`job-pull` contract has zero sft/dpo-specific logic baked
 * into it — buildRunArgv/buildStatusArgv/buildPullArgv and RealDispatcher
 * are already fully generic over {resource, capabilityJob}. Re-implementing
 * the same three argv builders here would just be copy-paste drift risk
 * against the one real dispatch contract; see training/realDispatcher.ts
 * for the argv construction + spawn details (shell:false, never a shell
 * string built from external input).
 */
export { buildRunArgv, buildStatusArgv, buildPullArgv, RealDispatcher } from "../training/realDispatcher.js";
export type {
  RunArgvOptions,
  StatusArgvOptions,
  PullArgvOptions,
  RealDispatcherConfig,
  RemoteComputeArgvBase,
} from "../training/realDispatcher.js";
