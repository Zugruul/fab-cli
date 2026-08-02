import { describe, it, expect } from "vitest";
import { parseJudgeResponse } from "../src/sampling/parse.js";

describe("parseJudgeResponse — entailed", () => {
  it("parses a clean JSON object with entailed: true", () => {
    const result = parseJudgeResponse('{"entailed": true, "reason": "fully supported by the chunk"}');
    expect("verdict" in result).toBe(true);
    if ("verdict" in result) {
      expect(result.verdict.entailed).toBe(true);
      expect(result.verdict.reason).toBe("fully supported by the chunk");
    }
  });

  it("repairs a response wrapped in a ```json code fence", () => {
    const raw = '```json\n{"entailed": true, "reason": "matches the chunk"}\n```';
    const result = parseJudgeResponse(raw);
    expect("verdict" in result).toBe(true);
    if ("verdict" in result) expect(result.verdict.entailed).toBe(true);
  });

  it("repairs a response with stray prose around the JSON object", () => {
    const raw = 'Sure, here is my verdict:\n{"entailed": true, "reason": "supported"}\nHope that helps!';
    const result = parseJudgeResponse(raw);
    expect("verdict" in result).toBe(true);
    if ("verdict" in result) expect(result.verdict.reason).toBe("supported");
  });
});

describe("parseJudgeResponse — not entailed", () => {
  it("parses a clean JSON object with entailed: false and keeps the reason", () => {
    const result = parseJudgeResponse('{"entailed": false, "reason": "the answer invents a fact the chunk never states"}');
    expect("verdict" in result).toBe(true);
    if ("verdict" in result) {
      expect(result.verdict.entailed).toBe(false);
      expect(result.verdict.reason).toBe("the answer invents a fact the chunk never states");
    }
  });
});

describe("parseJudgeResponse — malformed JSON", () => {
  it("returns an error for unparseable text, never a verdict", () => {
    const result = parseJudgeResponse("{entailed: true, reason: not valid json,,,");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/unparseable/i);
  });

  it("returns an error when the parsed value is an array, not an object", () => {
    const result = parseJudgeResponse('[{"entailed": true, "reason": "x"}]');
    expect("error" in result).toBe(true);
  });

  it("returns an error when entailed is missing or not boolean", () => {
    const result = parseJudgeResponse('{"reason": "x"}');
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/entailed/i);
  });

  it("returns an error when reason is missing or empty", () => {
    const result = parseJudgeResponse('{"entailed": true, "reason": ""}');
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/reason/i);
  });
});

describe("parseJudgeResponse — refusal", () => {
  it("returns an error for a prose refusal with no JSON at all", () => {
    const result = parseJudgeResponse("I'm sorry, I can't help evaluate this request.");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/unparseable|not a json/i);
  });
});

describe("parseJudgeResponse — truncated", () => {
  it("returns an error for a response cut off mid-JSON", () => {
    const result = parseJudgeResponse('{"entailed": true, "reason": "the answer is supp');
    expect("error" in result).toBe(true);
  });
});
