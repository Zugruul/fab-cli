/**
 * Suite registry (SPEC-APP.md §8.4): the single data-driven table
 * describing all eight suites — mirrors the repo's existing registry
 * precedent (fab-app/src/i18n/locales/index.ts: "the single place a
 * shipped [suite] is registered ... everything downstream derives from
 * this data"). Adding a suite is one entry here plus its item source, not
 * new runner logic.
 */
import type { DatasetExample } from "../../dataset/types.js";
import { EVAL_SUITE_IDS, type EvalItem, type EvalSuiteId } from "../types.js";
import {
  selectAdjudicationCritical,
  selectAbstentionQuality,
  selectCitationValidity,
  selectDistractorRobustness,
  selectInteractions,
  selectLore,
  selectOodRejection,
} from "./fromDataset.js";

/** Which scorer runner.ts dispatches an item to, independent of the
 * item's own `expected.kind` for the two suites (citation-validity,
 * abstain-expected) whose grading logic is structural rather than
 * content-based — see runner.ts. */
export type SuiteScorerKind = "expected" | "citation" | "abstain";

export interface SuiteDef {
  id: EvalSuiteId;
  scorer: SuiteScorerKind;
  /** Dataset-sourced suites: called once per DatasetExample in the eval
   * split; returns null when the example doesn't belong to this suite.
   * Absent for the human-authored suite, whose items are committed
   * content loaded separately (suites/humanAuthored.ts) — see
   * runner.ts's buildItemsBySuite. */
  selectFromDataset?: (example: DatasetExample) => EvalItem | null;
}

export const SUITE_REGISTRY: readonly SuiteDef[] = [
  { id: "adjudication-critical", scorer: "expected", selectFromDataset: selectAdjudicationCritical },
  { id: "interactions", scorer: "expected", selectFromDataset: selectInteractions },
  { id: "lore", scorer: "expected", selectFromDataset: selectLore },
  { id: "citation-validity", scorer: "citation", selectFromDataset: selectCitationValidity },
  { id: "abstention-quality", scorer: "abstain", selectFromDataset: selectAbstentionQuality },
  { id: "ood-rejection", scorer: "abstain", selectFromDataset: selectOodRejection },
  { id: "distractor-robustness", scorer: "expected", selectFromDataset: selectDistractorRobustness },
  { id: "human-authored-adjudication", scorer: "expected" },
];

// Registration completeness self-check, run at module load: every id in
// EVAL_SUITE_IDS (@fab/manifest-schema's canonical list) must have exactly
// one SUITE_REGISTRY entry, and vice versa — a suite named in the schema
// but not registered here (or registered but misspelled) would silently
// never run, which is worse than a loud failure at import time.
(function assertRegistryMatchesCanonicalSuiteIds(): void {
  const registered = new Set(SUITE_REGISTRY.map((s) => s.id));
  const canonical = new Set<string>(EVAL_SUITE_IDS);
  for (const id of EVAL_SUITE_IDS) {
    if (!registered.has(id)) throw new Error(`eval suite registry: "${id}" is a canonical suite id with no SUITE_REGISTRY entry`);
  }
  for (const s of SUITE_REGISTRY) {
    if (!canonical.has(s.id)) throw new Error(`eval suite registry: "${s.id}" is registered but not one of @fab/manifest-schema's EVAL_SUITE_IDS`);
  }
})();

/** Builds every dataset-sourced suite's items in one pass over
 * `examples` (avoids re-scanning the eval split once per suite). The
 * human-authored suite is not included — its items come from committed
 * content (suites/humanAuthored.ts), merged in by the caller. */
export function buildDatasetSuiteItems(examples: readonly DatasetExample[]): Record<string, EvalItem[]> {
  const bySuite: Record<string, EvalItem[]> = {};
  for (const def of SUITE_REGISTRY) {
    if (def.selectFromDataset) bySuite[def.id] = [];
  }
  for (const example of examples) {
    for (const def of SUITE_REGISTRY) {
      if (!def.selectFromDataset) continue;
      const item = def.selectFromDataset(example);
      if (item) bySuite[def.id].push(item);
    }
  }
  return bySuite;
}
