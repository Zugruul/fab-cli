import { configHash } from "../qa/manifest.js";
import type { PairSamplingOutcome, SamplingConfig, SamplingProgressState, SamplingRunResult } from "./types.js";

const SCHEMA_VERSION = "0.1.0"; // local/plain for now, matches qa/manifest.ts's convention

/** The chunk_id's leading path segment — `brain/…`, `rules/…`, `lore/…`
 * (see src/sources/{brains,rules,lore}.ts's chunk_id schemes) — used as
 * the per-category grouping key for SPEC-APP.md §7.4's "acceptance rate
 * is logged per run", broken out by category rather than only reported
 * in aggregate. */
export function categoryOf(chunk_id: string): string {
  const slash = chunk_id.indexOf("/");
  return slash === -1 ? chunk_id : chunk_id.slice(0, slash);
}

export interface CategoryAcceptance {
  category: string;
  accepted: number;
  rejected: number;
  /** accepted / (accepted + rejected); 0 when the category had zero
   * outcomes this run (rather than NaN — a category with nothing
   * processed still needs a well-formed number in the manifest). */
  acceptanceRate: number;
}

export interface SamplingRunManifest {
  schemaVersion: string;
  runDate: string;
  judgeModel: string;
  configHash: string;
  dryRun: boolean;
  /** Total pairs the run was invoked against (including any already
   * accepted/rejected from a prior run and skipped this time). */
  pairCount: number;
  /** Pairs actually attempted THIS invocation. */
  processedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  /** acceptedCount / processedCount this run; 0 when processedCount is 0. */
  acceptanceRate: number;
  categoryAcceptance: CategoryAcceptance[];
  costUsd: number;
  requestCount: number;
  stoppedEarly: string | null;
}

export interface BuildSamplingManifestOptions {
  config: SamplingConfig;
  dryRun: boolean;
  pairCount: number;
  outcomes: PairSamplingOutcome[];
  progress: SamplingProgressState;
  stoppedEarly: SamplingRunResult["stoppedEarly"];
  now?: () => string;
}

export function buildSamplingManifest(opts: BuildSamplingManifestOptions): SamplingRunManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  let acceptedCount = 0;
  let rejectedCount = 0;
  const byCategory = new Map<string, { accepted: number; rejected: number }>();

  for (const outcome of opts.outcomes) {
    const category = categoryOf(outcome.chunk_id);
    const bucket = byCategory.get(category) ?? { accepted: 0, rejected: 0 };
    if (outcome.status === "accepted") {
      acceptedCount++;
      bucket.accepted++;
    } else {
      rejectedCount++;
      bucket.rejected++;
    }
    byCategory.set(category, bucket);
  }

  const categoryAcceptance: CategoryAcceptance[] = Array.from(byCategory.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, { accepted, rejected }]) => ({
      category,
      accepted,
      rejected,
      acceptanceRate: accepted + rejected > 0 ? accepted / (accepted + rejected) : 0,
    }));

  return {
    schemaVersion: SCHEMA_VERSION,
    runDate: now(),
    judgeModel: opts.config.judgeModel,
    configHash: configHash(opts.config),
    dryRun: opts.dryRun,
    pairCount: opts.pairCount,
    processedCount: opts.outcomes.length,
    acceptedCount,
    rejectedCount,
    acceptanceRate: opts.outcomes.length > 0 ? acceptedCount / opts.outcomes.length : 0,
    categoryAcceptance,
    costUsd: opts.progress.costUsd,
    requestCount: opts.progress.requestCount,
    stoppedEarly: opts.stoppedEarly?.reason ?? null,
  };
}
