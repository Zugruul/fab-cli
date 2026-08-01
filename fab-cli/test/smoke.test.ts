import { describe, it, expect } from "vitest";
import { computeWinRate } from "../src/graphql";
import type { GameResult } from "../src/types";

function game(result: GameResult["result"]): GameResult {
  return { result } as GameResult;
}

describe("computeWinRate", () => {
  it("counts wins and losses, excluding draws from the total", () => {
    const results = [game("Won"), game("Won"), game("Lost"), game("Draw")];
    const { wins, losses, total, winRate } = computeWinRate(results);
    expect(wins).toBe(2);
    expect(losses).toBe(1);
    expect(total).toBe(3);
    expect(winRate).toBeCloseTo(2 / 3);
  });

  it("returns a zero win rate when there are no decisive games", () => {
    expect(computeWinRate([game("Draw")])).toEqual({
      wins: 0,
      losses: 0,
      total: 0,
      winRate: 0,
    });
    expect(computeWinRate([])).toEqual({
      wins: 0,
      losses: 0,
      total: 0,
      winRate: 0,
    });
  });
});
