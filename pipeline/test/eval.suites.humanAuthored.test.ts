import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findNearDuplicateQuestions, HumanAuthoredContentError, loadHumanAuthoredItems } from "../src/eval/suites/humanAuthored.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-eval-human-adjudication-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, records: unknown[]): void {
  fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(records));
}

const VALID_RECORD = {
  id: "cr-3-1-1",
  question: "If a hero has two instances of Go again active, does a card with Go again grant a third instance?",
  expectedClaims: ["No — Go again is not stackable; multiple sources of Go again on the same action do not grant multiple extra actions."],
  groundingChunkIds: ["rules/reprise/example-set"],
  sourceUrl: "https://fabtcg.com/rules-reprise-example",
};

describe("loadHumanAuthoredItems", () => {
  it("loads a valid item and converts it to an EvalItem in the human-authored-adjudication suite", () => {
    writeFile("001.json", [VALID_RECORD]);
    const items = loadHumanAuthoredItems(tmpDir);
    expect(items).toHaveLength(1);
    expect(items[0].suite).toBe("human-authored-adjudication");
    expect(items[0].sourceUrl).toBe(VALID_RECORD.sourceUrl);
    expect(items[0].expected).toEqual({ kind: "rubric", claims: VALID_RECORD.expectedClaims });
  });

  it("loads multiple files in sorted-filename order, concatenated", () => {
    writeFile("002.json", [{ ...VALID_RECORD, id: "cr-b" }]);
    writeFile("001.json", [{ ...VALID_RECORD, id: "cr-a" }]);
    const items = loadHumanAuthoredItems(tmpDir);
    expect(items.map((i) => i.id)).toEqual(["human-authored-adjudication__cr-a", "human-authored-adjudication__cr-b"]);
  });

  it("ignores non-.json files in the directory", () => {
    writeFile("001.json", [VALID_RECORD]);
    fs.writeFileSync(path.join(tmpDir, "README.md"), "not content");
    expect(loadHumanAuthoredItems(tmpDir)).toHaveLength(1);
  });

  // --- RUNTIME GUARD: sourceUrl is required, not just typed as a string ---

  it("throws on a record with an empty sourceUrl", () => {
    writeFile("001.json", [{ ...VALID_RECORD, sourceUrl: "" }]);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(HumanAuthoredContentError);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/sourceUrl/);
  });

  it("throws on a record missing sourceUrl entirely (bypassing the TS type via raw JSON)", () => {
    const { sourceUrl: _sourceUrl, ...withoutSourceUrl } = VALID_RECORD;
    writeFile("001.json", [withoutSourceUrl]);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/sourceUrl/);
  });

  it("throws on a record with empty expectedClaims", () => {
    writeFile("001.json", [{ ...VALID_RECORD, expectedClaims: [] }]);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/expectedClaims/);
  });

  it("throws on a record missing question", () => {
    const { question: _question, ...withoutQuestion } = VALID_RECORD;
    writeFile("001.json", [withoutQuestion]);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/question/);
  });

  it("throws on a duplicate id across files", () => {
    writeFile("001.json", [VALID_RECORD]);
    writeFile("002.json", [VALID_RECORD]);
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/duplicate/i);
  });

  it("throws when a file's top-level JSON is not an array", () => {
    fs.writeFileSync(path.join(tmpDir, "001.json"), JSON.stringify(VALID_RECORD));
    expect(() => loadHumanAuthoredItems(tmpDir)).toThrow(/array/);
  });
});

describe("findNearDuplicateQuestions", () => {
  it("flags exact-duplicate question text", () => {
    writeFile("001.json", [VALID_RECORD, { ...VALID_RECORD, id: "cr-dup" }]);
    const items = loadHumanAuthoredItems(tmpDir);
    const dups = findNearDuplicateQuestions(items);
    expect(dups).toHaveLength(1);
  });

  it("flags near-duplicate (high token overlap) question text above the threshold", () => {
    writeFile("001.json", [
      VALID_RECORD,
      { ...VALID_RECORD, id: "cr-near", question: VALID_RECORD.question + " Please clarify." },
    ]);
    const items = loadHumanAuthoredItems(tmpDir);
    expect(findNearDuplicateQuestions(items, 0.8).length).toBeGreaterThan(0);
  });

  it("does not flag genuinely distinct questions", () => {
    writeFile("001.json", [VALID_RECORD, { ...VALID_RECORD, id: "cr-distinct", question: "How many action points does a 2H weapon attack cost?" }]);
    const items = loadHumanAuthoredItems(tmpDir);
    expect(findNearDuplicateQuestions(items)).toHaveLength(0);
  });
});
