// Unit tests for ClaudeCodeTeacherClient (issue #223): the TeacherClient
// backed by `claude -p` headless mode, riding the user's Claude
// subscription instead of a metered ANTHROPIC_API_KEY. Every test here
// runs against a scripted fake `claude` binary (pipeline/test/fixtures/) —
// the real binary is NEVER spawned in this suite, mirroring the
// mock-transport discipline AnthropicTeacherClient's tests already use
// (see qa.helpers.ts's makeMockTeacher / fixtureSpawnFn).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeTeacherClient, ClaudeCliError } from "../src/qa/claudeCodeTeacher.js";
import { withRetry } from "../src/qa/retry.js";
import { fixtureSpawnFn, noopSleep } from "./qa.helpers.js";
import type { TeacherRequest } from "../src/qa/types.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const HAPPY = path.join(FIXTURES_DIR, "fake-claude-happy.mjs");
const HAPPY_NO_USAGE = path.join(FIXTURES_DIR, "fake-claude-happy-no-usage.mjs");
const MALFORMED = path.join(FIXTURES_DIR, "fake-claude-malformed.mjs");
const MODEL_ERROR = path.join(FIXTURES_DIR, "fake-claude-model-error.mjs");
const RATE_LIMIT = path.join(FIXTURES_DIR, "fake-claude-rate-limit.mjs");

function request(overrides: Partial<TeacherRequest> = {}): TeacherRequest {
  return {
    model: "claude-sonnet-5",
    maxTokens: 2048,
    system: "You are a terse teacher. SYSTEM_MARKER_XYZ",
    user: "chunk_id: chunk-1\nUSER_MARKER_ABC",
    ...overrides,
  };
}

describe("ClaudeCodeTeacherClient", () => {
  it("invokes the CLI with the user content as -p, the system prompt via --system-prompt, the requested model via --model, --output-format json, and disables tools/settings-discovery (--tools \"\" --setting-sources \"\") to keep the call clean of this repo's own CLAUDE.md/tool-schema overhead", async () => {
    const spawnSpy = vi.fn(fixtureSpawnFn(HAPPY));
    const client = new ClaudeCodeTeacherClient({ spawn: spawnSpy });

    await client.generate(request());

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [command, args] = spawnSpy.mock.calls[0];
    expect(command).toBe("claude"); // default binaryPath
    expect(args).toEqual([
      "-p",
      "chunk_id: chunk-1\nUSER_MARKER_ABC",
      "--output-format",
      "json",
      "--model",
      "claude-sonnet-5",
      "--system-prompt",
      "You are a terse teacher. SYSTEM_MARKER_XYZ",
      "--tools",
      "",
      "--setting-sources",
      "",
    ]);
  });

  it("respects a custom binaryPath instead of the default \"claude\"", async () => {
    const spawnSpy = vi.fn(fixtureSpawnFn(HAPPY));
    const client = new ClaudeCodeTeacherClient({ spawn: spawnSpy, binaryPath: "/custom/path/to/claude" });

    await client.generate(request());

    expect(spawnSpy.mock.calls[0][0]).toBe("/custom/path/to/claude");
  });

  it("parses a successful CLI response's `result` into text and usage.input_tokens/output_tokens into inputTokens/outputTokens", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(HAPPY) });

    const response = await client.generate(request());

    expect(response).toEqual({
      text: "FAKE_CLAUDE_HAPPY_RESULT",
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("zeroes usage (never crashes, never fabricates a value) when a successful response's JSON body has no `usage` field at all", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(HAPPY_NO_USAGE) });

    const response = await client.generate(request());

    expect(response).toEqual({
      text: "FAKE_CLAUDE_NO_USAGE_RESULT",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("throws a ClaudeCliError with no retryable status when the CLI exits 0 but stdout is not valid JSON", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(MALFORMED) });

    const err = await client.generate(request()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaudeCliError);
    expect((err as ClaudeCliError).status).toBeUndefined();
    expect((err as Error).message).toMatch(/not json at all|JSON/i);
  });

  it("throws a ClaudeCliError carrying the CLI's own api_error_status (non-retryable, e.g. 404 model-not-found)", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(MODEL_ERROR) });

    const err = await client.generate(request()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaudeCliError);
    expect((err as ClaudeCliError).status).toBe(404);
    expect((err as Error).message).toMatch(/issue with the selected model/i);
  });

  it("throws a ClaudeCliError with a synthetic 429 status for a rate-limit-shaped failure that has no structured JSON body", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(RATE_LIMIT) });

    const err = await client.generate(request()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaudeCliError);
    expect((err as ClaudeCliError).status).toBe(429);
    expect((err as Error).message).toMatch(/usage limit/i);
  });

  it("integrates with retry.ts's default isRetryable (status 429/5xx) with NO custom predicate needed — a rate-limit failure gets retried, not thrown immediately", async () => {
    const client = new ClaudeCodeTeacherClient({ spawn: fixtureSpawnFn(RATE_LIMIT) });
    const sleep = vi.fn(noopSleep);

    await expect(
      withRetry(() => client.generate(request()), { maxRetries: 2, baseDelayMs: 10, sleep }),
    ).rejects.toBeInstanceOf(ClaudeCliError);

    // initial attempt + 2 retries = 3 calls; retry.ts's *unmodified* default
    // isRetryable is what makes this happen (no isRetryable override passed above).
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rejects when the claude binary itself cannot be spawned (not installed / not on PATH) — a real spawn ENOENT, no fixture involved", async () => {
    const client = new ClaudeCodeTeacherClient({ binaryPath: "/definitely/not/a/real/claude/binary-xyz" });

    const err = await client.generate(request()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/claude|spawn|ENOENT/i);
  });
});
