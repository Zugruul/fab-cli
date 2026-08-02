import type { RetrievalFloors } from "./types";

export interface OodSignalInput {
  cardNameMatched: boolean;
  topActivation: number;
  lexicalHitCount: number;
}

export interface OodSignal {
  belowFloor: boolean;
  oodFastRefusal: boolean;
}

/**
 * §10.4/§10.9 signal computation.
 *
 * `belowFloor` is the §10.4 "not clearly settled" trigger — topActivation
 * under the manifest's calibrated retrievalFloor. On its own this is NOT
 * out-of-domain; it takes the judge-escalation path, not a refusal.
 *
 * `oodFastRefusal` is the §10.9 fast-path trigger, deliberately STRICTER
 * than belowFloor — all three conjuncts must hold: no card-name match AND
 * topActivation below the separate (lower) oodThreshold AND near-zero
 * lexical/tag overlap. "Near-zero lexical/tag overlap" is implemented as
 * exactly zero lexical seed hits: lexical seeding (§9.7) is a discrete
 * hit/no-hit signal (exact tag/card-name match), not a continuous overlap
 * score, so there is no fractional "near" band to threshold against — zero
 * hits is the only value that means "no lexical/tag overlap".
 */
export function computeOodSignal(input: OodSignalInput, floors: RetrievalFloors): OodSignal {
  const belowFloor = input.topActivation < floors.retrievalFloor;
  const oodFastRefusal =
    !input.cardNameMatched && input.topActivation < floors.oodThreshold && input.lexicalHitCount === 0;
  return { belowFloor, oodFastRefusal };
}
