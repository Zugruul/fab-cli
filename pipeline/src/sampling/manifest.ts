import { configHash } from "../qa/manifest.js";
import type { PairSamplingOutcome, SamplingConfig, SamplingProgressState, SamplingRunResult } from "./types.js";

const SCHEMA_VERSION = "0.2.0"; // bumped for rejectionKind split (review round); local/plain for now, matches qa/manifest.ts's convention

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
  /** Kept for compat with the pre-rejectionKind manifest shape — always
   * equals rejectedNotEntailed + rejectedInfra. */
  accepted: number;
  rejected: number;
  /** Rejected with rejectionKind "not-entailed" — a genuine, conclusive
   * judge verdict against the pair's content. */
  rejectedNotEntailed: number;
  /** Rejected with rejectionKind "infra-error" — the check never reached
   * a conclusive verdict (judge API failure, unparseable/refusal/
   * truncated response, or missing source chunk). Carries no signal about
   * the pair's actual entailment. */
  rejectedInfra: number;
  /** accepted / (accepted + rejectedNotEntailed) — infra-error rejections
   * are EXCLUDED, so a run's reported entailment quality isn't distorted
   * by an unrelated judge-API outage (SPEC-APP.md §7.4 review round: "an
   * outage shouldn't tank the acceptance rate"). 0 when accepted +
   * rejectedNotEntailed is 0 (rather than NaN). */
  acceptanceRate: number;
  /** accepted / (accepted + rejected) — the un-adjusted rate INCLUDING
   * infra-error rejections, kept alongside acceptanceRate for anyone who
   * wants the raw denominator instead of the entailment-only one. 0 when
   * accepted + rejected is 0. */
  rawAcceptanceRate: number;
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
  /** Kept for compat — always equals rejectedNotEntailedCount +
   * rejectedInfraCount. */
  rejectedCount: number;
  rejectedNotEntailedCount: number;
  rejectedInfraCount: number;
  /** acceptedCount / (acceptedCount + rejectedNotEntailedCount) —
   * infra-error rejections excluded, so this is the number that actually
   * reflects entailment quality this run (see CategoryAcceptance's
   * acceptanceRate doc for why). 0 when the denominator is 0. */
  acceptanceRate: number;
  /** acceptedCount / processedCount — the un-adjusted rate INCLUDING
   * infra-error rejections, kept alongside acceptanceRate. 0 when
   * processedCount is 0. */
  rawAcceptanceRate: number;
  categoryAcceptance: CategoryAcceptance[];
  costUsd: number;
  requestCount: number;
  stoppedEarly: string | null;
  /** BUG-180 guard: pairIds whose recorded content hash didn't match this
   * run's content and were reprocessed instead of silently honored with
   * the stale verdict — see sampler.ts's runSampling. 0 when omitted. */
  staleReprocessedCount: number;
  /** BUG-180 guard: pairIds honored as done-as-recorded because their
   * progress entry predates this guard (no hash to compare against) —
   * surfaced so this backward-compat pass-through is visible, never
   * silent. 0 when omitted. */
  legacyUnverifiedCount: number;
}

export interface BuildSamplingManifestOptions {
  config: SamplingConfig;
  dryRun: boolean;
  pairCount: number;
  outcomes: PairSamplingOutcome[];
  progress: SamplingProgressState;
  stoppedEarly: SamplingRunResult["stoppedEarly"];
  now?: () => string;
  /** See SamplingRunManifest's docs — both default to 0 when omitted, for
   * call sites written before BUG-180. */
  staleReprocessedCount?: number;
  legacyUnverifiedCount?: number;
}

export function buildSamplingManifest(opts: BuildSamplingManifestOptions): SamplingRunManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  let acceptedCount = 0;
  let rejectedNotEntailedCount = 0;
  let rejectedInfraCount = 0;
  const byCategory = new Map<string, { accepted: number; rejectedNotEntailed: number; rejectedInfra: number }>();

  for (const outcome of opts.outcomes) {
    const category = categoryOf(outcome.chunk_id);
    const bucket = byCategory.get(category) ?? { accepted: 0, rejectedNotEntailed: 0, rejectedInfra: 0 };
    if (outcome.status === "accepted") {
      acceptedCount++;
      bucket.accepted++;
    } else if (outcome.rejectionKind === "infra-error") {
      rejectedInfraCount++;
      bucket.rejectedInfra++;
    } else {
      // rejectionKind === "not-entailed" (the only other possibility for
      // a rejected outcome — see types.ts's RejectionKind).
      rejectedNotEntailedCount++;
      bucket.rejectedNotEntailed++;
    }
    byCategory.set(category, bucket);
  }

  const rejectedCount = rejectedNotEntailedCount + rejectedInfraCount;

  const categoryAcceptance: CategoryAcceptance[] = Array.from(byCategory.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, { accepted, rejectedNotEntailed, rejectedInfra }]) => ({
      category,
      accepted,
      rejected: rejectedNotEntailed + rejectedInfra,
      rejectedNotEntailed,
      rejectedInfra,
      acceptanceRate: accepted + rejectedNotEntailed > 0 ? accepted / (accepted + rejectedNotEntailed) : 0,
      rawAcceptanceRate:
        accepted + rejectedNotEntailed + rejectedInfra > 0
          ? accepted / (accepted + rejectedNotEntailed + rejectedInfra)
          : 0,
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
    rejectedNotEntailedCount,
    rejectedInfraCount,
    acceptanceRate: acceptedCount + rejectedNotEntailedCount > 0 ? acceptedCount / (acceptedCount + rejectedNotEntailedCount) : 0,
    rawAcceptanceRate: opts.outcomes.length > 0 ? acceptedCount / opts.outcomes.length : 0,
    categoryAcceptance,
    costUsd: opts.progress.costUsd,
    requestCount: opts.progress.requestCount,
    stoppedEarly: opts.stoppedEarly?.reason ?? null,
    staleReprocessedCount: opts.staleReprocessedCount ?? 0,
    legacyUnverifiedCount: opts.legacyUnverifiedCount ?? 0,
  };
}
