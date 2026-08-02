/**
 * storm590x remote training dispatch — pure command builders (#208).
 *
 * Every function here returns a plain argv array (or a small object of
 * argv arrays) and touches nothing — no spawning, no network. That's what
 * makes them testable character-exactly. dispatcher.ts is the only caller;
 * the real spawning lives behind RemoteExecutor in cli.ts.
 *
 * `buildTmuxLaunch` is where the risk concentrates: three layers of
 * quoting (ssh argv -> `bash -lc '...'` zsh-bypass -> tmux's own quoted
 * command string) have to compose correctly. See its doc comment.
 */
import type { DispatchConfig, StatusProbe } from "./types.js";

const SSH_BASE = ["ssh", "-o", "BatchMode=yes"];
const RSYNC_OVER_SSH = ["-e", "ssh -o BatchMode=yes"];

/**
 * Hard guard: a remoteBase that resolves under /mnt/ (WSL2's DrvFs mount
 * for the Windows filesystem) is banned — it's slow and the venv is
 * broken there (see CLAUDE.md remote-machine-facts). Called at the top of
 * every builder below so the guard fires no matter which entry point
 * (CLI, Dispatcher, or a direct call) constructs remote paths.
 */
export function validateConfig(config: DispatchConfig): void {
  const { remoteBase } = config;
  if (remoteBase === "/mnt" || remoteBase.startsWith("/mnt/")) {
    throw new Error(
      `DispatchConfig.remoteBase resolves under /mnt/ (DrvFs) — got "${remoteBase}". ` +
        "The remote working dir must be on ext4 under the home dir (e.g. ~/fab-training); " +
        "DrvFs is slow and the training venv is broken there.",
    );
  }
}

function remoteRunDir(runId: string, config: DispatchConfig): string {
  return `${config.remoteBase}/${runId}`;
}

function sessionName(runId: string, config: DispatchConfig): string {
  return `${config.tmuxSessionPrefix}-${runId}`;
}

function remoteShell(config: DispatchConfig, script: string): string[] {
  return [...SSH_BASE, config.host, `bash -lc '${script}'`];
}

/**
 * rsync -az --delete push of localPaths to storm590x:<remoteBase>/<runId>/,
 * excluding .git, node_modules, and artifacts/ (artifacts flow the other
 * way, via buildRsyncPull, so they're never pushed).
 */
export function buildRsyncPush(runId: string, localPaths: string[], config: DispatchConfig): string[] {
  validateConfig(config);
  const dest = `${config.host}:${remoteRunDir(runId, config)}/`;
  return [
    "rsync",
    "-az",
    "--delete",
    ...RSYNC_OVER_SSH,
    "--exclude",
    ".git",
    "--exclude",
    "node_modules",
    "--exclude",
    "artifacts/",
    ...localPaths,
    dest,
  ];
}

/**
 * ssh argv wrapping `bash -lc 'tmux new-session -d -s <prefix>-<runId>
 * "cd <remoteBase>/<runId> && <trainCmd> 2>&1 | tee run.log"'`.
 *
 * Three quoting layers, outside in:
 *  1. The whole `bash -lc '...'` argument is single-quoted so the remote
 *     zsh login shell (ssh's default) hands it to bash literally, unparsed
 *     — this is the zsh-bypass: remote commands must run under bash, not
 *     the account's zsh.
 *  2. Inside that, the double-quoted string is tmux's own command
 *     argument — the shell tmux spawns for the pane re-parses it, so `cd`
 *     and `&&` behave normally there.
 *  3. trainArgv is joined with plain spaces (no per-token escaping) —
 *     acceptable in v1 because call sites are internal/controlled, not
 *     user-supplied shell strings.
 *
 * `-d` detaches immediately so the session survives the SSH connection
 * closing. Output is teed to run.log inside the run's own directory so
 * buildStatusProbe's tail works without re-deriving the path.
 */
export function buildTmuxLaunch(runId: string, trainArgv: string[], config: DispatchConfig): string[] {
  validateConfig(config);
  const session = sessionName(runId, config);
  const dir = remoteRunDir(runId, config);
  const trainCmd = trainArgv.join(" ");
  const innerCmd = `cd ${dir} && ${trainCmd} 2>&1 | tee run.log`;
  const tmuxCmd = `tmux new-session -d -s ${session} "${innerCmd}"`;
  return remoteShell(config, tmuxCmd);
}

/**
 * Two independent probes for Dispatcher#status to run in sequence:
 * `tmux has-session -t <session>` (exit code carries the running/finished
 * signal) and `tail -n <tailLines> run.log` (the log excerpt). Kept as two
 * commands rather than one chained remote string so the has-session exit
 * code isn't swallowed by a later pipeline stage.
 */
export function buildStatusProbe(runId: string, config: DispatchConfig, tailLines = 50): StatusProbe {
  validateConfig(config);
  const session = sessionName(runId, config);
  const dir = remoteRunDir(runId, config);
  return {
    hasSession: remoteShell(config, `tmux has-session -t ${session}`),
    tailLog: remoteShell(config, `tail -n ${tailLines} ${dir}/run.log`),
  };
}

/**
 * Full-path nvidia-smi query (the binary isn't on the non-interactive
 * WSL2 PATH — see CLAUDE.md remote-machine-facts), CSV output for easy
 * parsing.
 */
export function buildGpuProbe(config: DispatchConfig): string[] {
  validateConfig(config);
  const query = `${config.nvidiaSmiPath} --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader`;
  return remoteShell(config, query);
}

/**
 * rsync -az pull of <remoteBase>/<runId>/<remoteArtifactDir>/ down to
 * localDest. No --delete: pulling artifacts should never remove local
 * files the caller didn't ask to overwrite.
 */
export function buildRsyncPull(
  runId: string,
  remoteArtifactDir: string,
  localDest: string,
  config: DispatchConfig,
): string[] {
  validateConfig(config);
  const src = `${config.host}:${remoteRunDir(runId, config)}/${remoteArtifactDir}/`;
  return ["rsync", "-az", ...RSYNC_OVER_SSH, src, localDest];
}
