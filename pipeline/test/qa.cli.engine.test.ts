// --engine flag parsing + resolution precedence (issue #223, AC2). Kept
// separate from qa.cli.test.ts (BUG-190's chunks-fulltext concern) since
// this is an unrelated axis of cli.ts behavior.
import { describe, it, expect } from "vitest";
import { parseArgs, resolveEngineId } from "../src/qa/cli.js";
import { DEFAULT_ENGINE_ID } from "../src/qa/engine.js";
import type { GenerationConfig } from "../src/qa/types.js";

function baseConfig(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    teacherModel: "claude-sonnet-5",
    maxTokens: 2048,
    pairsPerChunk: 4,
    diversityInstructions: ["Vary phrasing."],
    batch: { size: 10, maxConcurrent: 3, requestsPerMinute: 30 },
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 5 },
    maxRetries: 3,
    retryBaseDelayMs: 500,
    ...overrides,
  };
}

describe("qa/cli.ts --engine flag", () => {
  it("defaults to no explicit engine override (null) — parseArgs itself carries no default-engine policy", () => {
    expect(parseArgs([]).engine).toBeNull();
  });

  it("--engine anthropic-api sets an explicit override", () => {
    expect(parseArgs(["--engine", "anthropic-api"]).engine).toBe("anthropic-api");
  });

  it("--engine claude-code-subscription can also be passed explicitly", () => {
    expect(parseArgs(["--engine", "claude-code-subscription"]).engine).toBe("claude-code-subscription");
  });

  it("an unrecognized --engine value throws immediately rather than silently falling back to anything", () => {
    expect(() => parseArgs(["--engine", "gpt-4"])).toThrow(/engine/i);
  });
});

describe("resolveEngineId — precedence: CLI flag > committed config > DEFAULT_ENGINE_ID", () => {
  it("uses DEFAULT_ENGINE_ID (claude-code-subscription) when neither the CLI flag nor the config specify one", () => {
    expect(resolveEngineId(parseArgs([]), baseConfig())).toBe(DEFAULT_ENGINE_ID);
    expect(resolveEngineId(parseArgs([]), baseConfig())).toBe("claude-code-subscription");
  });

  it("uses the committed config's engine field when no CLI flag is given", () => {
    expect(resolveEngineId(parseArgs([]), baseConfig({ engine: "anthropic-api" }))).toBe("anthropic-api");
  });

  it("the CLI flag overrides the committed config's engine field", () => {
    const args = parseArgs(["--engine", "claude-code-subscription"]);
    expect(resolveEngineId(args, baseConfig({ engine: "anthropic-api" }))).toBe("claude-code-subscription");
  });
});
