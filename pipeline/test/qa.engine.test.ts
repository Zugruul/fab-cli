// Engine selection (issue #223, AC2): which TeacherClient transport
// carries teacher calls. "claude-code-subscription" (headless `claude -p`,
// riding the user's Claude subscription) is the DEFAULT; "anthropic-api"
// (the existing metered-API client) is an explicit opt-in only — this
// suite guards against it ever becoming an implicit/auto-selected default.
import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_ID, ENGINE_IDS, buildTeacherClient, isEngineId } from "../src/qa/engine.js";
import { ClaudeCodeTeacherClient } from "../src/qa/claudeCodeTeacher.js";
import { AnthropicTeacherClient } from "../src/qa/teacher.js";

describe("engine selection", () => {
  it("defaults to claude-code-subscription — never anthropic-api — so the default is never silently billable", () => {
    expect(DEFAULT_ENGINE_ID).toBe("claude-code-subscription");
  });

  it("recognizes exactly the two known engine ids and nothing else", () => {
    expect(ENGINE_IDS).toEqual(["claude-code-subscription", "anthropic-api"]);
    expect(isEngineId("claude-code-subscription")).toBe(true);
    expect(isEngineId("anthropic-api")).toBe(true);
    expect(isEngineId("gpt-4")).toBe(false);
    expect(isEngineId("")).toBe(false);
  });

  it("buildTeacherClient(claude-code-subscription) returns a ClaudeCodeTeacherClient", () => {
    expect(buildTeacherClient("claude-code-subscription")).toBeInstanceOf(ClaudeCodeTeacherClient);
  });

  it("buildTeacherClient(anthropic-api) returns an AnthropicTeacherClient, constructible even with no ANTHROPIC_API_KEY set (matches cli.ts's existing unconditional construction — the SDK only fails at call time, not construction time)", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(buildTeacherClient("anthropic-api")).toBeInstanceOf(AnthropicTeacherClient);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
