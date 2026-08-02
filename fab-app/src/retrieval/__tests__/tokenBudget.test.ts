import { estimateTokens } from "../tokenBudget";

describe("estimateTokens (§14 chars/4 heuristic)", () => {
  it("estimates tokens as chars/charsPerToken, rounding up", () => {
    expect(estimateTokens("a".repeat(4), 4)).toBe(1);
    expect(estimateTokens("a".repeat(5), 4)).toBe(2);
    expect(estimateTokens("a".repeat(8), 4)).toBe(2);
    expect(estimateTokens("a".repeat(9), 4)).toBe(3);
  });

  it("returns 0 for empty text", () => {
    expect(estimateTokens("", 4)).toBe(0);
  });

  it("respects a configured charsPerToken other than the §14 default of 4", () => {
    expect(estimateTokens("a".repeat(10), 5)).toBe(2);
    expect(estimateTokens("a".repeat(11), 5)).toBe(3);
  });
});
