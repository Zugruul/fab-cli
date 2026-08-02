/**
 * storm590x remote training dispatch — the Dispatcher state machine
 * (#208). Wraps a RemoteExecutor (the only thing that touches real
 * ssh/rsync) with the four operations E2 training runs need: push code,
 * launch inside tmux, poll status, pull artifacts back. No retries or
 * backoff in v1 — kept deliberately tight; a non-zero exec code is always
 * surfaced as a typed DispatchError, never swallowed, and an executor
 * rejection (network failure, ssh not found, ...) propagates unwrapped.
 */
import { buildRsyncPush, buildTmuxLaunch, buildStatusProbe, buildRsyncPull, validateConfig } from "./commands.js";
import { DEFAULT_DISPATCH_CONFIG } from "./types.js";
import type { DispatchConfig, RemoteExecutor, RunStatus } from "./types.js";

export class DispatchError extends Error {
  readonly code: number;
  readonly stderr: string;

  constructor(message: string, code: number, stderr: string) {
    super(message);
    this.name = "DispatchError";
    this.code = code;
    this.stderr = stderr;
  }
}

export interface PushResult {
  runId: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface LaunchResult {
  runId: string;
  session: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface StatusResult {
  runId: string;
  status: RunStatus;
  logTail: string;
}

export interface PullResult {
  runId: string;
  code: number;
  stdout: string;
  stderr: string;
}

/** tmux's own "no such session" wording varies by version; match loosely. */
const NO_SESSION_PATTERN = /no session|can't find session|session not found/i;

export class Dispatcher {
  private readonly executor: RemoteExecutor;
  private readonly config: DispatchConfig;

  constructor(executor: RemoteExecutor, config: DispatchConfig = DEFAULT_DISPATCH_CONFIG) {
    validateConfig(config);
    this.executor = executor;
    this.config = config;
  }

  async push(runId: string, localPaths: string[]): Promise<PushResult> {
    const argv = buildRsyncPush(runId, localPaths, this.config);
    const result = await this.executor.run(argv);
    if (result.code !== 0) {
      throw new DispatchError(`rsync push failed for run "${runId}" (exit ${result.code})`, result.code, result.stderr);
    }
    return { runId, code: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  async launch(runId: string, trainArgv: string[]): Promise<LaunchResult> {
    const argv = buildTmuxLaunch(runId, trainArgv, this.config);
    const result = await this.executor.run(argv);
    if (result.code !== 0) {
      throw new DispatchError(`tmux launch failed for run "${runId}" (exit ${result.code})`, result.code, result.stderr);
    }
    return {
      runId,
      session: `${this.config.tmuxSessionPrefix}-${runId}`,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async status(runId: string, tailLines = 50): Promise<StatusResult> {
    const probe = buildStatusProbe(runId, this.config, tailLines);
    const hasSessionResult = await this.executor.run(probe.hasSession);
    let status: RunStatus;
    if (hasSessionResult.code === 0) {
      status = "running";
    } else if (NO_SESSION_PATTERN.test(hasSessionResult.stderr)) {
      status = "finished";
    } else {
      status = "unknown";
    }
    const tailResult = await this.executor.run(probe.tailLog);
    return { runId, status, logTail: tailResult.stdout };
  }

  async pullArtifacts(runId: string, remoteArtifactDir: string, localDest: string): Promise<PullResult> {
    const argv = buildRsyncPull(runId, remoteArtifactDir, localDest, this.config);
    const result = await this.executor.run(argv);
    if (result.code !== 0) {
      throw new DispatchError(`rsync pull failed for run "${runId}" (exit ${result.code})`, result.code, result.stderr);
    }
    return { runId, code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}
