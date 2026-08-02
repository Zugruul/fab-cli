/**
 * storm590x remote training dispatch — shared types (#208, E2/APP-020 prep).
 * The RTX 5090 training box lives outside the dev Mac; this module pushes
 * code+data to it over rsync, launches training inside a detached tmux
 * session (so runs survive SSH disconnects), polls status, and pulls
 * artifacts back. See CLAUDE.md's remote-machine-facts (verified
 * 2026-08-02) for why these particular defaults exist:
 *  - remote shell is zsh, so every remote command is wrapped `bash -lc`
 *  - nvidia-smi isn't on the non-interactive PATH under WSL2
 *  - the working dir MUST be on ext4 under the home dir, never /mnt/
 *    (DrvFs) — see validateConfig in commands.ts
 *
 * There is deliberately no `pythonPath` field: nothing in this module
 * ever invokes python directly (a prior draft carried a decorative,
 * unused `pythonPath` — see PR #213 review round 2, Finding 2). The
 * remote python interpreter lives in a uv-managed venv, not on a bare
 * `python3` PATH — callers must put the full remote path (e.g.
 * `~/.venv/bin/python3`) as `trainArgv[0]` when calling
 * `Dispatcher#launch`, since the remote shell for the launched command is
 * non-interactive zsh (no venv activation happens automatically). That
 * `~/...`-prefixed example is verified against `buildTmuxLaunch`'s actual
 * escaping, not just documentation: a round-2 escaping pass quoted the
 * leading `~` along with the rest of the token, which silently defeats
 * tilde expansion (`'~/.venv/bin/python3'` never resolves) — fixed in
 * review round 3 by quoting each trainArgv token with the same
 * tilde-preserving treatment `commands.ts` already used for remote paths
 * (see `shQuotePath` there).
 */

export interface DispatchConfig {
  /** SSH alias/host for the remote training machine. */
  host: string;
  /** Remote base directory runs are pushed under (one subdir per runId). Must resolve on ext4, never /mnt/. */
  remoteBase: string;
  /** Full path to nvidia-smi — not on the non-interactive WSL2 PATH. */
  nvidiaSmiPath: string;
  /** Prefix for the detached tmux session name; the full name is `${prefix}-${runId}`. */
  tmuxSessionPrefix: string;
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  host: "storm590x",
  remoteBase: "~/fab-training",
  nvidiaSmiPath: "/usr/lib/wsl/lib/nvidia-smi",
  tmuxSessionPrefix: "fab-train",
};

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The only thing that touches real ssh/rsync binaries. Command builders in
 * commands.ts return plain argv arrays; a RemoteExecutor is what actually
 * spawns them. Tests use a fake; cli.ts wires a real child_process one.
 */
export interface RemoteExecutor {
  run(cmd: string[]): Promise<ExecResult>;
}

export type RunStatus = "running" | "finished" | "unknown";

export interface StatusProbe {
  /** ssh argv: `tmux has-session -t <session>` — exit 0 means the session is alive. */
  hasSession: string[];
  /** ssh argv: `tail -n N run.log` inside the run's remote directory. */
  tailLog: string[];
}
