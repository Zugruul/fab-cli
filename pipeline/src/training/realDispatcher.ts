/**
 * Real TrainingDispatcher: shells out to remote-compute.py's `run` /
 * `job-status` / `job-pull` verbs (development-skills/plugins/
 * spec-workflow/scripts/remote-compute.py) to drive the slm-training
 * capability bundle on a registered resource (storm590x). Per the issue's
 * dispatch contract, all remote training goes through this generic,
 * config-file-driven bundle — never ad-hoc ssh.
 *
 * argv construction (buildRunArgv/buildStatusArgv/buildPullArgv) is pure
 * and unit-tested exactly. The RealDispatcher class itself spawns argv
 * directly (shell:false — never a shell string built from external input,
 * matching dispatch/cli.ts's ChildProcessExecutor convention) and is NOT
 * exercised in tests: no real ssh/remote-compute.py invocation happens in
 * this repo's test suite. The real-machine run is the orchestrator's job,
 * post-review.
 *
 * `run`'s --param config=<name> value is a REMOTE-relative path: the
 * bundle's job template renders `train.py --config {config}` on the
 * machine, after `--inputs <dir>` has already rsynced <dir>/ into the
 * resource's declared capability workdir. So the config file must live
 * inside inputsDir under that same basename before dispatch — run() copies
 * it there if it isn't already (runner.ts writes config.json into the run
 * dir, not inputsDir, so this copy is the normal path).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DispatcherStatus, TrainingDispatcher } from "./types.js";

export interface RemoteComputeArgvBase {
  pythonBin: string;
  remoteComputePyPath: string;
}

export interface RunArgvOptions extends RemoteComputeArgvBase {
  resource: string;
  /** e.g. "slm-training:sft". */
  capabilityJob: string;
  /** Basename the config file will have inside inputsDir once rsynced. */
  configName: string;
  inputsDir: string;
  jobId: string;
}

export function buildRunArgv(opts: RunArgvOptions): string[] {
  return [
    opts.pythonBin,
    opts.remoteComputePyPath,
    "run",
    opts.resource,
    opts.capabilityJob,
    "--param",
    `config=${opts.configName}`,
    "--inputs",
    opts.inputsDir,
    "--job-id",
    opts.jobId,
  ];
}

export interface StatusArgvOptions extends RemoteComputeArgvBase {
  jobId: string;
}

export function buildStatusArgv(opts: StatusArgvOptions): string[] {
  return [opts.pythonBin, opts.remoteComputePyPath, "job-status", opts.jobId];
}

export interface PullArgvOptions extends RemoteComputeArgvBase {
  jobId: string;
  destDir: string;
}

export function buildPullArgv(opts: PullArgvOptions): string[] {
  return [opts.pythonBin, opts.remoteComputePyPath, "job-pull", opts.jobId, "--dest", opts.destDir];
}

export interface RealDispatcherConfig {
  resource: string;
  /** e.g. "slm-training:sft" or "slm-training:dpo". */
  capabilityJob: string;
  remoteComputePyPath: string;
  pythonBin?: string;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function execArgv(argv: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = argv;
    const child = spawn(bin, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export class RealDispatcher implements TrainingDispatcher {
  private readonly config: RealDispatcherConfig;

  constructor(config: RealDispatcherConfig) {
    this.config = config;
  }

  private base(): RemoteComputeArgvBase {
    return { pythonBin: this.config.pythonBin ?? "python3", remoteComputePyPath: this.config.remoteComputePyPath };
  }

  async run(configLocalPath: string, inputsDir: string, jobId: string): Promise<{ jobId: string }> {
    const configName = path.basename(configLocalPath);
    const destPath = path.join(inputsDir, configName);
    if (path.resolve(configLocalPath) !== path.resolve(destPath)) {
      fs.mkdirSync(inputsDir, { recursive: true });
      fs.copyFileSync(configLocalPath, destPath);
    }

    const argv = buildRunArgv({
      ...this.base(),
      resource: this.config.resource,
      capabilityJob: this.config.capabilityJob,
      configName,
      inputsDir,
      jobId,
    });
    const result = await execArgv(argv);
    if (result.code !== 0) {
      throw new Error(`remote-compute.py run failed (exit ${result.code}): ${result.stderr || result.stdout}`);
    }
    return { jobId };
  }

  async status(jobId: string): Promise<DispatcherStatus> {
    const argv = buildStatusArgv({ ...this.base(), jobId });
    const result = await execArgv(argv);
    const text = result.stdout;
    if (/state:\s*completed/.test(text)) return "completed";
    if (/state:\s*failed/.test(text)) return "failed";
    // "state: running" or "state: unknown (resource unreachable: ...)" both
    // mean "not yet terminal" — a transient probe failure is not evidence
    // of training failure, so it's treated as still-running and re-polled.
    return "running";
  }

  async pullArtifacts(jobId: string, destDir: string): Promise<void> {
    const argv = buildPullArgv({ ...this.base(), jobId, destDir });
    const result = await execArgv(argv);
    if (result.code !== 0) {
      throw new Error(`remote-compute.py job-pull failed (exit ${result.code}): ${result.stderr || result.stdout}`);
    }
  }
}
