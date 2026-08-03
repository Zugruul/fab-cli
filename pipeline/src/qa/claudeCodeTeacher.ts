import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { TeacherClient, TeacherRequest, TeacherResponse } from "./types.js";

/**
 * Teacher implementation backed by Claude Code headless mode (`claude -p`),
 * riding the user's Claude subscription instead of a metered
 * ANTHROPIC_API_KEY (issue #223). Deliberately the only module in
 * pipeline/src/qa that spawns the real `claude` binary — every other
 * module (and this class's own tests) work against a scripted fake `claude`
 * fixture (see pipeline/test/fixtures/, injected via `spawn`), mirroring
 * teacher.ts's AnthropicTeacherClient never touching its real SDK client in
 * tests.
 *
 * Flag choices, verified live against the installed `claude` binary
 * (`claude --help`) and documented in pipeline/src/qa/README.md:
 *   -p <user>                positional prompt = TeacherRequest.user
 *   --output-format json     single JSON result object on stdout, not a stream
 *   --model <model>          TeacherRequest.model passed straight through
 *   --system-prompt <system> FULL system-prompt replacement (not
 *                            --append-system-prompt) — TeacherRequest.system
 *                            is already a complete instruction set, so
 *                            appending it to Claude Code's own default
 *                            system prompt would just add irrelevant
 *                            interactive-agent instructions to every call
 *   --tools ""                disables the built-in tool set. A teacher call
 *                            is pure text generation — no tool use is ever
 *                            needed — and enabling tools bloats every
 *                            single call with the built-in tool schema
 *                            (~23k input tokens observed live, vs. ~180
 *                            with tools off)
 *   --setting-sources ""      disables CLAUDE.md / project settings
 *                            auto-discovery. Without this, running the
 *                            pipeline from inside this repo pulls this
 *                            repo's own (large, FAB-CLI-specific) CLAUDE.md
 *                            into every teacher call's context — irrelevant
 *                            to Q&A generation and a further large,
 *                            unnecessary cost
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export interface ClaudeCodeTeacherClientOptions {
  /** Path/name of the claude CLI binary to spawn. Defaults to "claude"
   * (resolved via PATH) — the real headless client. Tests override this
   * (or `spawn`) to point at a fixture instead. */
  binaryPath?: string;
  /** Injectable process spawner, defaulting to node:child_process's spawn.
   * Tests use this to run a scripted fake `claude` script under node
   * instead of the real binary (see qa.helpers.ts's fixtureSpawnFn) —
   * production code never overrides this. */
  spawn?: SpawnFn;
}

/** Shape of the fields this client reads from `claude -p --output-format
 * json`'s single-result object. The real output carries many more fields
 * (cost, cache, timing, session id, ...) — TeacherResponse has no home for
 * those today, so they're deliberately not mapped (see the class docs). */
interface ClaudeCliResult {
  is_error?: boolean;
  result?: string;
  api_error_status?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Error raised for any `claude -p` CLI failure. Carries an HTTP-style
 * `status` whenever one can be determined — either the CLI's own
 * `api_error_status` field, or a synthetic 429 inferred from a
 * rate-limit-shaped message when the CLI fails before it can even emit a
 * structured JSON body — so retry.ts's UNMODIFIED default `isRetryable`
 * (status 429 or 5xx) already knows to retry it. Errors with no
 * determinable status are treated as non-retryable, same as how the
 * Anthropic SDK's own typed errors already behave in this codebase.
 */
export class ClaudeCliError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ClaudeCliError";
    this.status = status;
  }
}

// A rate-limited/subscription-usage-limited `claude -p` failure has no
// documented structured shape (unlike a clean model-not-found error, which
// carries api_error_status) — this is a best-effort text match over
// whatever the CLI printed (JSON `result` field if present, else raw
// stdout/stderr), covering the phrasing patterns Claude Code and the
// Claude API are known to use for capacity/quota failures.
const RATE_LIMIT_PATTERN = /rate.?limit|usage limit|overloaded|try again (later|in)|quota exceeded/i;

function inferStatus(apiErrorStatus: number | undefined, text: string): number | undefined {
  if (typeof apiErrorStatus === "number") return apiErrorStatus;
  if (RATE_LIMIT_PATTERN.test(text)) return 429;
  return undefined;
}

function runProcess(
  spawnFn: SpawnFn,
  binaryPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(new ClaudeCliError(`failed to spawn "${binaryPath}": ${err.message}`));
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export class ClaudeCodeTeacherClient implements TeacherClient {
  private readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;

  constructor(opts: ClaudeCodeTeacherClientOptions = {}) {
    this.binaryPath = opts.binaryPath ?? "claude";
    // node:child_process's real `spawn` is a heavily overloaded function;
    // it always satisfies our minimal SpawnFn shape at the one call site
    // that actually uses it (runProcess, below), but isn't structurally
    // assignable to SpawnFn as a whole per TS's overload-assignability
    // rules — hence the cast rather than fighting the overloads.
    this.spawnFn = opts.spawn ?? (nodeSpawn as SpawnFn);
  }

  async generate(request: TeacherRequest): Promise<TeacherResponse> {
    const args = [
      "-p",
      request.user,
      "--output-format",
      "json",
      "--model",
      request.model,
      "--system-prompt",
      request.system,
      "--tools",
      "",
      "--setting-sources",
      "",
    ];

    const { stdout, stderr, exitCode } = await runProcess(this.spawnFn, this.binaryPath, args);

    let parsed: ClaudeCliResult | undefined;
    try {
      parsed = JSON.parse(stdout) as ClaudeCliResult;
    } catch {
      parsed = undefined;
    }

    if (exitCode !== 0 || parsed?.is_error) {
      const rawText = parsed?.result ?? (stderr.trim() || stdout.trim() || `claude exited with code ${exitCode}`);
      const status = inferStatus(parsed?.api_error_status, `${rawText}\n${stderr}`);
      throw new ClaudeCliError(`claude -p failed (exit ${exitCode}): ${rawText}`, status);
    }

    if (!parsed) {
      // Exit 0 but stdout wasn't valid JSON — shouldn't happen with
      // --output-format json, but a "successful" call must never silently
      // resolve to empty text; surface it loudly instead.
      throw new ClaudeCliError(
        `claude -p exited 0 but produced no parseable JSON output: ${stdout.slice(0, 500)}`,
      );
    }

    return {
      text: parsed.result ?? "",
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      },
    };
  }
}
