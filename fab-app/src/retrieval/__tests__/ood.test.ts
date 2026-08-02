import { computeOodSignal } from "../ood";
import type { RetrievalFloors } from "../types";

// §10.9: the OOD fast-path trigger is a strict three-conjunct rule, and is
// deliberately STRICTER than §10.4's plain "below the abstention floor"
// signal: "no card-name match AND retrieval scores below a separate OOD
// threshold calibrated well below the abstention floor AND near-zero
// lexical/tag overlap with the FAB vocabulary". oodThreshold (0.2) sits
// below retrievalFloor (0.5) in every fixture below, matching "well below".
const floors: RetrievalFloors = { retrievalFloor: 0.5, oodThreshold: 0.2 };

describe("computeOodSignal", () => {
  describe("§10.9 three-conjunct OOD truth table", () => {
    test.each([
      // cardNameMatched, topActivation, lexicalHitCount, expectedOodFastRefusal
      [false, 0.05, 0, true], // all three conjuncts hold -> fast refusal
      [true, 0.05, 0, false], // card name matched -> not OOD
      [false, 0.5, 0, false], // topActivation at/above oodThreshold -> not OOD
      [false, 0.05, 1, false], // a lexical/tag hit exists -> not OOD
      [true, 0.5, 1, false], // none of the three conjuncts hold
      [true, 0.05, 1, false], // two of three hold, one doesn't -> not OOD
      [true, 0.5, 0, false], // two of three hold, one doesn't -> not OOD
      [false, 0.5, 1, false], // two of three hold, one doesn't -> not OOD
    ])(
      "cardNameMatched=%s topActivation=%s lexicalHitCount=%s -> oodFastRefusal=%s",
      (cardNameMatched, topActivation, lexicalHitCount, expected) => {
        const signal = computeOodSignal({ cardNameMatched, topActivation, lexicalHitCount }, floors);
        expect(signal.oodFastRefusal).toBe(expected);
      },
    );
  });

  it("topActivation exactly at oodThreshold does not trigger OOD (strict less-than)", () => {
    const signal = computeOodSignal({ cardNameMatched: false, topActivation: 0.2, lexicalHitCount: 0 }, floors);
    expect(signal.oodFastRefusal).toBe(false);
  });

  describe("§10.4 belowFloor vs §10.9 oodFastRefusal", () => {
    it("a near-floor question with no card name is belowFloor but NOT oodFastRefusal — takes the judge-escalation path, not a refusal", () => {
      const signal = computeOodSignal({ cardNameMatched: false, topActivation: 0.45, lexicalHitCount: 0 }, floors);
      expect(signal.belowFloor).toBe(true); // 0.45 < retrievalFloor 0.5
      expect(signal.oodFastRefusal).toBe(false); // 0.45 is NOT below the separate, lower oodThreshold 0.2
    });

    it("activation at/above the floor is not belowFloor", () => {
      const signal = computeOodSignal({ cardNameMatched: false, topActivation: 0.5, lexicalHitCount: 5 }, floors);
      expect(signal.belowFloor).toBe(false);
    });

    it("activation just under the floor is belowFloor", () => {
      const signal = computeOodSignal({ cardNameMatched: true, topActivation: 0.499, lexicalHitCount: 5 }, floors);
      expect(signal.belowFloor).toBe(true);
    });
  });
});
