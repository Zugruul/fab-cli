/**
 * storm590x remote training dispatch — pure command builders (#208).
 *
 * Every function here returns a plain argv array (or a small object of
 * argv arrays) and touches nothing — no spawning, no network. That's what
 * makes them testable character-exactly. dispatcher.ts is the only caller;
 * the real spawning lives behind RemoteExecutor in cli.ts.
 *
 * `buildTmuxLaunch` is where the risk concentrates: THREE shells parse
 * (parts of) the command in sequence before training ever runs — this is
 * the exact chain a real `ssh storm590x '<cmd>'` non-interactive exec
 * goes through, verified against a live shell simulation during PR #213
 * review round 2:
 *
 *   1. The **remote login shell** (zsh — the account's default shell,
 *      what ssh's non-interactive exec invokes) parses our whole ssh
 *      command argument as one shell command line. We hand it
 *      `bash -lc '<SCRIPT>'`; the single quotes exist so this shell hands
 *      `<SCRIPT>` to bash *completely unparsed* (the "zsh-bypass" — every
 *      training command must run under bash, not the account's zsh).
 *   2. **`bash -lc`** then genuinely parses `<SCRIPT>` as a real command
 *      line: `tmux new-session -d -s <session> -c <dir> "<inner>"`. The
 *      `<inner>` train-command string sits inside a *double*-quoted bash
 *      argument (needed so the whole pipeline-containing string reaches
 *      tmux as one argv element, not several).
 *   3. **tmux** hands `<inner>` to a **third** shell (the pane's default
 *      shell — zsh again) to actually execute the training command.
 *
 * Round-1 shipped `<inner>`'s tokens raw-joined with no escaping at all,
 * so any apostrophe in a trainArgv token (or in runId) broke out of shell
 * 1's outer single-quoting and ran as remote shell syntax — a real
 * injection, reproduced and confirmed fixed via a live zsh/tmux
 * simulation in review round 2 (a crafted `--notes` payload created a
 * marker file under the old code; it did not under this one). The fix:
 * every dynamic token gets POSIX single-quote-escaped for the shell that
 * will finally consume it (`shQuote`/`shQuotePath`), and because that
 * escaping itself introduces `'`/`\` characters, each quoting layer's
 * *composed* output is re-escaped for whichever shell wraps it next
 * (`dqEscape` for bash's double-quote layer, then `remoteShell`'s own
 * `shQuote` for the outermost single-quote layer) — working strictly
 * inside-out. runId is additionally restricted to a safe charset
 * (`validateRunId`) as defense in depth: it's an operator-chosen label,
 * there's no reason to accept shell metacharacters in it at all.
 */
import type { DispatchConfig, StatusProbe } from "./types.js";

const SSH_BASE = ["ssh", "-o", "BatchMode=yes"];
const RSYNC_OVER_SSH = ["-e", "ssh -o BatchMode=yes"];

/** Run ids are operator-chosen labels, not free-form data — restrict to a safe charset outright rather than trying to escape through it. */
const SAFE_RUN_ID = /^[A-Za-z0-9._-]+$/;

export function validateRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(
      `runId "${runId}" is not a safe identifier — only letters, digits, ".", "_", and "-" are allowed ` +
        "(runId is embedded in remote shell commands; no reason to accept shell metacharacters in an operator-chosen label).",
    );
  }
}

/**
 * Hard guard against a remoteBase resolving under /mnt/ (WSL2's DrvFs
 * mount for the Windows filesystem) — it's slow and the venv is broken
 * there (see CLAUDE.md remote-machine-facts). This is an operator-typo
 * guard, not a security boundary: remoteBase is a trusted config value
 * (default or an explicit --remote-base flag), not per-run untrusted
 * input, so this validates plausibility, not adversarial input. It
 * rejects `..` outright (no legitimate remoteBase needs it), collapses
 * repeated slashes, and matches `/mnt/` as a whole path *segment*
 * case-insensitively — so `/mnt/f/...`, `//mnt/f/...`, and `/MNT/f/...`
 * are all caught, while a segment merely containing "mnt" (e.g.
 * `~/mnt-backup/x`) is not a false positive. Called at the top of every
 * builder below so the guard fires no matter which entry point (CLI,
 * Dispatcher, or a direct call) constructs remote paths.
 */
export function validateConfig(config: DispatchConfig): void {
  const { remoteBase } = config;
  if (remoteBase.includes("..")) {
    throw new Error(
      `DispatchConfig.remoteBase must not contain ".." path segments — got "${remoteBase}". ` +
        "This is an operator-typo guard: no legitimate remote training directory needs to traverse upward.",
    );
  }
  const segments = remoteBase
    .replace(/\/+/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  if (segments.includes("mnt")) {
    throw new Error(
      `DispatchConfig.remoteBase resolves under a /mnt/ (DrvFs) path segment — got "${remoteBase}". ` +
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

/** Standard POSIX single-quote shell-escaping: wraps `value` so whichever shell parses it next (unquoted context) treats it as exactly one literal word, no matter what it contains. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Escapes the characters that are special inside a bash/zsh *double*-quoted string ($ ` " \) so `value` — which may itself already contain shQuote's own '/\\ output — survives being placed inside "...". */
function dqEscape(value: string): string {
  return value.replace(/[\\$`"]/g, (c) => `\\${c}`);
}

/**
 * Like shQuote, but for a *path* that may start with `~` or `~/` — those
 * need to stay unquoted so the consuming shell still performs tilde
 * expansion to $HOME; only the remainder (if any) is quoted. Shells
 * concatenate an unquoted tilde-prefix with an immediately-following
 * quoted segment into one word, so `~/'rest of path'` still expands
 * correctly.
 */
function shQuotePath(pathStr: string): string {
  if (pathStr === "~") return "~";
  if (pathStr.startsWith("~/")) return "~/" + shQuote(pathStr.slice(2));
  return shQuote(pathStr);
}

/** Wraps `script` as `bash -lc '<script>'`, single-quote-escaping the whole composed script for the outermost (remote login zsh) layer — see this file's doc comment for why that's the correct, generic, layer-agnostic thing to do regardless of what's nested inside `script`. */
function remoteShell(config: DispatchConfig, script: string): string[] {
  return [...SSH_BASE, config.host, `bash -lc ${shQuote(script)}`];
}

/**
 * rsync -az --delete push of localPaths to storm590x:<remoteBase>/<runId>/,
 * excluding .git, node_modules, and artifacts/ (artifacts flow the other
 * way, via buildRsyncPull, so they're never pushed).
 */
export function buildRsyncPush(runId: string, localPaths: string[], config: DispatchConfig): string[] {
  validateConfig(config);
  validateRunId(runId);
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
 * `mkdir -p` the run's remote directory. rsync (buildRsyncPush) refuses
 * to create nested parent directories on its own (exit 11 against a
 * missing remote dir, confirmed against the real storm590x box in review
 * round 2) — Dispatcher#push runs this first, every time, before rsync.
 */
export function buildEnsureRunDir(runId: string, config: DispatchConfig): string[] {
  validateConfig(config);
  validateRunId(runId);
  const dir = remoteRunDir(runId, config);
  return remoteShell(config, `mkdir -p ${shQuotePath(dir)}`);
}

/**
 * ssh argv wrapping `bash -lc 'tmux new-session -d -s <prefix>-<runId>
 * -c <remoteBase>/<runId> "<trainCmd> 2>&1 | tee run.log"'` — see this
 * file's doc comment for the full three-shell chain and the escaping
 * that keeps it injection-safe. `-c <dir>` (tmux's own start-directory
 * flag) replaces a round-1 `cd <dir> &&` prefix baked into the executed
 * command string — tmux applies it directly, no extra shell parsing
 * needed for the directory.
 *
 * `-d` detaches immediately so the session survives the SSH connection
 * closing. Output is teed to run.log inside the run's own directory so
 * buildStatusProbe's tail works without re-deriving the path.
 */
export function buildTmuxLaunch(runId: string, trainArgv: string[], config: DispatchConfig): string[] {
  validateConfig(config);
  validateRunId(runId);
  const session = sessionName(runId, config);
  const dir = remoteRunDir(runId, config);
  const trainCmd = trainArgv.map(shQuote).join(" ");
  const innerRaw = `${trainCmd} 2>&1 | tee run.log`;
  const innerForBash = dqEscape(innerRaw);
  const scriptRaw = `tmux new-session -d -s ${shQuote(session)} -c ${shQuotePath(dir)} "${innerForBash}"`;
  return remoteShell(config, scriptRaw);
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
  validateRunId(runId);
  const session = sessionName(runId, config);
  const dir = remoteRunDir(runId, config);
  return {
    hasSession: remoteShell(config, `tmux has-session -t ${shQuote(session)}`),
    tailLog: remoteShell(config, `tail -n ${tailLines} ${shQuotePath(dir)}/run.log`),
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
  validateRunId(runId);
  const src = `${config.host}:${remoteRunDir(runId, config)}/${remoteArtifactDir}/`;
  return ["rsync", "-az", ...RSYNC_OVER_SSH, src, localDest];
}
