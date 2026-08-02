/**
 * storm590x remote training dispatch — the Dispatcher state machine
 * (#208). Wraps a RemoteExecutor (the only thing that touches real
 * ssh/rsync) with the four operations E2 training runs need: push code,
 * launch inside tmux, poll status, pull artifacts back. No retries or
 * backoff in v1 — kept deliberately tight; a non-zero exec code is always
 * surfaced as a typed DispatchError, never swallowed, and an executor
 * rejection (network failure, ssh not found, ...) propagates unwrapped.
 */
import {
  buildRsyncPush,
  buildTmuxLaunch,
  buildStatusProbe,
  buildRsyncPull,
  buildEnsureRunDir,
  validateConfig,
} from "./commands.js";
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
  /** Populated from the tail probe's stderr only when its exec code !== 0. Unlike push/launch/pullArtifacts, status never throws on a failed sub-command (see the doc comment on #status) — this is how that failure surfaces instead. */
  tailError?: string;
}

export interface PullResult {
  runId: string;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * tmux's own "no such session" wording varies by version/context — real
 * storm590x tmux was observed (PR #213 review round 2 smoke) to say
 * "no server running on /tmp/tmux-1000/default" once the server itself
 * had exited (all sessions ended), not the "can't find session ..."
 * phrasing round 1's tests assumed. Match all of the observed forms.
 */
const NO_SESSION_PATTERN = /no session|can't find session|session not found|no server running/i;

export class Dispatcher {
  private readonly executor: RemoteExecutor;
  private readonly config: DispatchConfig;

  constructor(executor: RemoteExecutor, config: DispatchConfig = DEFAULT_DISPATCH_CONFIG) {
    validateConfig(config);
    this.executor = executor;
    this.config = config;
  }

  /**
   * rsync (buildRsyncPush) won't create nested remote parent directories
   * on its own — confirmed against the real storm590x box (exit 11)
   * during review round 2 — so this always `mkdir -p`s the run's remote
   * directory first. A failed mkdir surfaces as a typed DispatchError and
   * rsync is never attempted.
   */
  async push(runId: string, localPaths: string[]): Promise<PushResult> {
    const mkdirArgv = buildEnsureRunDir(runId, this.config);
    const mkdirResult = await this.executor.run(mkdirArgv);
    if (mkdirResult.code !== 0) {
      throw new DispatchError(
        `mkdir -p failed for run "${runId}" (exit ${mkdirResult.code})`,
        mkdirResult.code,
        mkdirResult.stderr,
      );
    }

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

  /**
   * Never throws, unlike push/launch/pullArtifacts — a polling loop must
   * be able to keep calling status even when e.g. run.log doesn't exist
   * yet or tmux is briefly unreachable. A failed tail probe is instead
   * surfaced as `tailError`; the running/finished/unknown mapping comes
   * entirely from the has-session probe and is unaffected by a tail
   * failure. finished only fires for tmux's own "no session" exit (code
   * 1) matched against known wording — any other non-zero code (e.g. an
   * ssh-level failure) maps to unknown rather than being guessed at.
   */
  async status(runId: string, tailLines = 50): Promise<StatusResult> {
    const probe = buildStatusProbe(runId, this.config, tailLines);
    const hasSessionResult = await this.executor.run(probe.hasSession);
    let status: RunStatus;
    if (hasSessionResult.code === 0) {
      status = "running";
    } else if (hasSessionResult.code === 1 && NO_SESSION_PATTERN.test(hasSessionResult.stderr)) {
      status = "finished";
    } else {
      status = "unknown";
    }

    const tailResult = await this.executor.run(probe.tailLog);
    const result: StatusResult = { runId, status, logTail: tailResult.stdout };
    if (tailResult.code !== 0) {
      result.tailError = tailResult.stderr;
    }
    return result;
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
