import { computeDiversityMetric, type DiversityMetric } from "./diversity.js";
import type { OODExample } from "./types.js";

/** Style/topic → phrasing templates (config/ood-templates.json). */
export type OODTemplateBank = Record<string, string[]>;

export interface OODBuildConfig {
  minCount: number;
  /** The single scoped-purpose refusal used as `target.answer` for every
   * OOD example — the trained refusal behavior is one consistent voice,
   * not per-question variation (SPEC-APP.md §10.9 fast-path / §7.5c). */
  refusalTemplate: string;
}

export interface OODBuildResult {
  examples: OODExample[];
  diversity: DiversityMetric;
}

/**
 * SPEC-APP.md §7.5c: out-of-domain refusal examples built from a broad,
 * config-committed template bank spanning many styles/topics (MTG named
 * only as a refusal-training input, never as knowledge — see
 * config/ood-templates.json). Every configured template becomes exactly
 * one example (maximizes both training value and the diversity metric,
 * since each is a cheap, valid, purely offline transform); `minCount`
 * enforces a floor on the bank's total size rather than trimming it down.
 * `confidence: "high"` on the target reflects certainty in the refusal
 * judgment itself, not a FAB-domain answer confidence.
 */
export function buildOODExamples(bank: OODTemplateBank, config: OODBuildConfig): OODBuildResult {
  const styles = Object.keys(bank).sort();
  const examples: OODExample[] = [];
  const used: { style: string; question: string }[] = [];

  for (const style of styles) {
    bank[style].forEach((question, index) => {
      examples.push({
        id: `ood-${style}-${index}`,
        category: "ood",
        style,
        question,
        target: { answer: config.refusalTemplate, citation_ids: [], confidence: "high" },
      });
      used.push({ style, question });
    });
  }

  if (examples.length < config.minCount) {
    throw new Error(`ood: built ${examples.length} example(s), below configured minimum ${config.minCount}`);
  }

  return { examples, diversity: computeDiversityMetric(bank, used) };
}
