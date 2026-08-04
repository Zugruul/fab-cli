// APP-024 (#136), SPEC-APP.md §10.2: "IF the target is unreachable on
// measured hardware (§8.6) THEN THE SYSTEM SHALL apply, in order: reduced
// retrieval budget -> tier downgrade -> relaxed target recorded in the
// release manifest — never silent shipping of a missed target."
//
// recordFallbackDecision does NOT auto-execute the ladder — re-measuring
// at a reduced retrieval budget, or downgrading tier and re-benchmarking,
// is a real device re-run, not a pure computation this function could
// perform on its own. It records a decision that was already made (by a
// human/QA process walking the ladder), and enforces the "never silent"
// half of §10.2 at this API boundary as well as in
// @fab/manifest-schema's FallbackLadderDecisionSchema: calling this with
// unmet targets and no resolution throws, and calling it with met targets
// plus a resolution (nothing needed fixing) also throws.

import type {
  FallbackLadderDecision,
  FallbackLadderStep,
} from '@fab/manifest-schema';
import type { TargetCheckResult } from './targets';

export interface FallbackResolution {
  stepApplied: FallbackLadderStep;
  notes: string;
}

export function recordFallbackDecision(
  targetCheck: TargetCheckResult,
  resolution?: FallbackResolution,
): FallbackLadderDecision {
  if (targetCheck.allMet) {
    if (resolution) {
      throw new Error(
        'recordFallbackDecision: a resolution was supplied but all §14/APP-033 targets were met — no fallback-ladder step should be recorded when nothing needed fallback',
      );
    }
    return {
      targetsMet: true,
      unmetMetrics: [],
      notes:
        'all measured §14/APP-033 targets met; no fallback-ladder step applied',
    };
  }

  if (!resolution) {
    throw new Error(
      `recordFallbackDecision: targets unmet (${targetCheck.unmetMetrics.join(
        ', ',
      )}) but no fallback-ladder resolution was supplied — SPEC-APP.md §10.2 never ships a missed target without recording which step was applied`,
    );
  }

  return {
    targetsMet: false,
    stepApplied: resolution.stepApplied,
    unmetMetrics: targetCheck.unmetMetrics,
    notes: resolution.notes,
  };
}
