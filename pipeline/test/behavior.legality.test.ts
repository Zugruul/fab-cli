import { describe, it, expect } from "vitest";
import { isLegalityChunk } from "../src/behavior/legality.js";
import { makeChunk, makeLegalityChunk } from "./behavior.helpers.js";

describe("isLegalityChunk", () => {
  it("is true for the live legality policy chunk_id scheme", () => {
    expect(isLegalityChunk(makeLegalityChunk())).toBe(true);
  });

  it("is true for a chunk tagged 'legality' even with an unusual chunk_id", () => {
    expect(isLegalityChunk(makeChunk({ chunk_id: "rules/other/x", tags: ["legality"] }))).toBe(true);
  });

  it("is false for an ordinary rules/brain/lore chunk", () => {
    expect(isLegalityChunk(makeChunk({ chunk_id: "rules/cr/1.1", tags: ["cr", "rules"] }))).toBe(false);
    expect(isLegalityChunk(makeChunk({ chunk_id: "judge/notes/kw-dominate", tags: ["keyword"] }))).toBe(false);
  });
});
