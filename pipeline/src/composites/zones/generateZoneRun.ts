/**
 * End-to-end, injectable-IO generation for one zone-layout run (#253) —
 * the zone-aware analog of generate.ts's generateDataset. Plans single-mat
 * composites plus near/far mat pairs for the two-player variant, downloads
 * ONLY the specific catalog printings actually picked (not the whole
 * catalog — semantic eligibility is a metadata-only filter, decoupled from
 * cache state, see semanticSelection.ts), renders every plan through the
 * SAME renderComposite compositor.ts already provides, merges the
 * two-player pairs, and returns a {manifest, composites} shape identical
 * to generate.ts's GenerateResult so it flows unchanged into
 * write.ts/sampleSheet.ts.
 */
import { renderComposite } from "../compositor.js";
import type { LoadedCard, RenderResult } from "../compositor.js";
import type { RawImage } from "../rawImage.js";
import { eligiblePrintingsForZoneKind } from "./semanticSelection.js";
import type { EligibleCard, RawCardForSelection, SelectableZoneKind } from "./semanticSelection.js";
import type { ZoneKind, ZoneMap } from "./zoneMap.js";
import { planZoneLayoutRun } from "./planZoneLayout.js";
import type { ZoneLayoutConfig } from "./planZoneLayout.js";
import { mergeTwoPlayerRenders } from "./twoPlayer.js";
import { buildZoneCompositeManifest } from "./zoneManifest.js";
import type { CompositeDatasetManifest } from "../manifest.js";
import { CoverageTracker } from "../coverageTracker.js";

/** Large, fixed, documented offsets so the two-player near/far mats each
 * get a seed distinct from the single-mat batch AND from each other —
 * without these, the near mat (same config.seed, same zone map, same
 * eligible pools as the single-mat batch) would draw the IDENTICAL rng
 * sequence as the single-mat batch's own index-0 composite, making the
 * two-player example's near half a wasted exact duplicate of
 * composite-0000 instead of a genuinely distinct scene (caught by eyeball
 * review of the real demo run, not a unit test — the fixture catalogs used
 * in tests are too small to make the duplication visually obvious). */
// Exported so tests can construct the exact same planZoneLayoutRun inputs
// generateZoneRun uses internally and compare PRE-merge plans directly —
// a post-merge comparison is unreliable here, since mergeTwoPlayerRenders
// always translates the near mat's card corners by +matHeight regardless
// of whether the underlying scene actually differs (see PR #255 review
// round 1: a mutation dropping this offset stayed undetected by a
// post-merge corner comparison for exactly that reason).
export const TWO_PLAYER_NEAR_SEED_OFFSET = 500_009;
export const TWO_PLAYER_FAR_SEED_OFFSET = 1_000_003;

export interface ImageNeed {
  printingId: string;
  imagePath: string;
  imageUrl: string;
}

export interface GenerateZoneRunInput {
  config: ZoneLayoutConfig;
  zoneMap: ZoneMap;
  /** The full vendored catalog (already loaded) — semantic eligibility is
   * computed from this directly, per zone kind actually present in
   * zoneMap. */
  cards: RawCardForSelection[];
  imagesCacheDir: string;
  loadImage: (imagePath: string) => Promise<RawImage>;
  /** Downloads exactly the distinct printings passed (already deduplicated
   * by this function) — a real cache hit inside the injected implementation
   * is expected to be a no-op, mirroring images/downloader.ts's own
   * cache-hit short-circuit. */
  ensureImagesDownloaded: (needs: ImageNeed[]) => Promise<void>;
  /** The playmat background, already decoded — a zone-layout run always
   * uses exactly one background image for the whole run (never a random
   * per-composite pick, unlike the base generator), so it's loaded once by
   * the caller rather than re-resolved here. */
  loadedBackground: RawImage;
  cardBackImagePath: string;
  cardBackPrintingId: string;
  matWidth: number;
  matHeight: number;
  background: { fileName: string; contentHash: string };
  singleCount: number;
  twoPlayerCount: number;
  now?: () => string;
  /** #268 PR #269 review round 1 BLOCKER 2 (partial scope — see PR body):
   * when true, card selection for every zone kind favors the globally
   * least-appeared-so-far eligible printing WITHIN that kind's own bucket
   * (planZoneLayout.ts's coverageTrackersByKind), instead of uniform-
   * random. One CoverageTracker per kind, shared across the single +
   * near + far sub-runs so appearance counts accumulate over the WHOLE
   * zone-generate run. Default false — byte-identical to pre-#268
   * behavior. This is selection-only: unlike composites/cli.ts's
   * --coverage, there is no unavailableUpstream tracking here (the zone
   * pipeline downloads only what's picked, AFTER planning — a download
   * failure here still aborts the run via assertDownloadsSucceeded,
   * unchanged; extending that to a tolerate-and-report model is future
   * work, not part of this fix). */
  coverage?: boolean;
}

/** Lightweight per-kind coverage summary (#268 BLOCKER 2) — deliberately
 * NOT the full three-state CoverageReport shape composites/cli.ts's
 * --coverage produces (see GenerateZoneRunInput.coverage's doc for why:
 * the zone pipeline has no "unavailable upstream" concept yet). Still
 * answers the review's "handle and report it" ask for a rare
 * single-zone-kind printing: `zeroAppearanceCount > 0` names exactly which
 * kind's budget was insufficient. */
export interface ZoneKindCoverageSummary {
  poolSize: number;
  minAppearances: number;
  maxAppearances: number;
  zeroAppearanceCount: number;
}

export interface GenerateZoneRunResult {
  manifest: CompositeDatasetManifest;
  composites: RenderResult[];
  /** Present only when `input.coverage` was true. */
  coverageSummary?: Partial<Record<SelectableZoneKind, ZoneKindCoverageSummary>>;
}

export function buildEligibleByKind(cards: RawCardForSelection[], zoneMap: ZoneMap, imagesCacheDir: string): Partial<Record<SelectableZoneKind, EligibleCard[]>> {
  const kinds = new Set<Exclude<ZoneKind, "deck">>();
  for (const zone of zoneMap.zones) {
    if (zone.kind !== "deck") kinds.add(zone.kind as Exclude<ZoneKind, "deck">);
  }
  const eligibleByKind: Partial<Record<SelectableZoneKind, EligibleCard[]>> = {};
  for (const kind of kinds) {
    eligibleByKind[kind] = eligiblePrintingsForZoneKind(cards, kind, imagesCacheDir);
  }
  return eligibleByKind;
}

export async function generateZoneRun(input: GenerateZoneRunInput): Promise<GenerateZoneRunResult> {
  const eligibleByKind = buildEligibleByKind(input.cards, input.zoneMap, input.imagesCacheDir);
  const cardBack = { printingId: input.cardBackPrintingId, imagePath: input.cardBackImagePath };

  // #268 BLOCKER 2: one tracker per kind, SHARED across single/near/far
  // below (never rebuilt per sub-run) so appearance counts accumulate over
  // the whole zone-generate run, not reset per sub-run — the same
  // "one CoverageTracker per pool for the whole run" discipline
  // composites/cli.ts's --coverage uses for the base generator.
  const coverageTrackersByKind: Partial<Record<SelectableZoneKind, CoverageTracker>> = {};
  if (input.coverage) {
    for (const [kind, pool] of Object.entries(eligibleByKind)) {
      if (pool) coverageTrackersByKind[kind as SelectableZoneKind] = new CoverageTracker(pool.length);
    }
  }

  const planCommon = {
    zoneMap: input.zoneMap,
    eligibleByKind,
    cardBack,
    matWidth: input.matWidth,
    matHeight: input.matHeight,
    background: input.background,
    coverageTrackersByKind,
  };

  const singlePlans = planZoneLayoutRun({ ...planCommon, config: input.config, compositesPerRun: input.singleCount, compositeIdPrefix: "composite" });
  const nearPlans = planZoneLayoutRun({
    ...planCommon,
    config: { ...input.config, seed: input.config.seed + TWO_PLAYER_NEAR_SEED_OFFSET },
    compositesPerRun: input.twoPlayerCount,
    compositeIdPrefix: "two-player-near",
  });
  const farPlans = planZoneLayoutRun({
    ...planCommon,
    config: { ...input.config, seed: input.config.seed + TWO_PLAYER_FAR_SEED_OFFSET },
    compositesPerRun: input.twoPlayerCount,
    compositeIdPrefix: "two-player-far",
  });

  // Every distinct catalog printing ACTUALLY PICKED across every plan —
  // deliberately NOT every printing in eligibleByKind's pools (those pools
  // can be enormous: "any card" kinds like pitch/graveyard/arsenal match
  // the ENTIRE catalog by design). Deduplicated so a card picked for
  // multiple composites (or for both near and far mats) is only ever
  // requested once — this is the "download what's needed for the run"
  // decoupling semanticSelection.ts's doc comment promises: eligibility is
  // a metadata-only filter, download only follows the actual picks.
  const imageUrlByPrintingId = new Map<string, string>();
  for (const pool of Object.values(eligibleByKind)) {
    for (const c of pool ?? []) imageUrlByPrintingId.set(c.printingId, c.imageUrl);
  }

  const needsByPrintingId = new Map<string, ImageNeed>();
  for (const plan of [...singlePlans, ...nearPlans, ...farPlans]) {
    for (const c of plan.cards) {
      if (c.isCardBack) continue; // the card back has its own dedicated fetch path (ensureCardBackCached), not this catalog-download step
      const imageUrl = imageUrlByPrintingId.get(c.printingId);
      if (imageUrl) needsByPrintingId.set(c.printingId, { printingId: c.printingId, imagePath: c.imagePath, imageUrl });
    }
  }
  await input.ensureImagesDownloaded([...needsByPrintingId.values()]);

  const imageCache = new Map<string, RawImage>();
  async function getImage(imagePath: string): Promise<RawImage> {
    const cached = imageCache.get(imagePath);
    if (cached) return cached;
    const loaded = await input.loadImage(imagePath);
    imageCache.set(imagePath, loaded);
    return loaded;
  }

  async function loadCardsForPlan(plan: { cards: { printingId: string; imagePath: string }[] }): Promise<LoadedCard[]> {
    const out: LoadedCard[] = [];
    for (const c of plan.cards) out.push({ printingId: c.printingId, image: await getImage(c.imagePath) });
    return out;
  }

  const singleResults: RenderResult[] = [];
  for (const plan of singlePlans) {
    const loadedCards = await loadCardsForPlan(plan);
    singleResults.push(renderComposite(plan, loadedCards, input.config.minVisibleFraction, input.loadedBackground));
  }

  const twoPlayerResults: RenderResult[] = [];
  for (let i = 0; i < nearPlans.length; i++) {
    const nearLoaded = await loadCardsForPlan(nearPlans[i]);
    const farLoaded = await loadCardsForPlan(farPlans[i]);
    const nearRender = renderComposite(nearPlans[i], nearLoaded, input.config.minVisibleFraction, input.loadedBackground);
    const farRender = renderComposite(farPlans[i], farLoaded, input.config.minVisibleFraction, input.loadedBackground);
    twoPlayerResults.push(mergeTwoPlayerRenders(nearRender, farRender, `two-player-${String(i).padStart(4, "0")}`));
  }

  const composites = [...singleResults, ...twoPlayerResults];
  const manifest = buildZoneCompositeManifest({ config: input.config, labels: composites.map((c) => c.label), now: input.now });

  if (!input.coverage) return { manifest, composites };

  const coverageSummary: Partial<Record<SelectableZoneKind, ZoneKindCoverageSummary>> = {};
  for (const [kind, tracker] of Object.entries(coverageTrackersByKind)) {
    if (!tracker) continue;
    const counts = tracker.allAppearanceCounts();
    coverageSummary[kind as SelectableZoneKind] = {
      poolSize: counts.length,
      minAppearances: counts.length === 0 ? 0 : Math.min(...counts),
      maxAppearances: counts.length === 0 ? 0 : Math.max(...counts),
      zeroAppearanceCount: counts.filter((c) => c === 0).length,
    };
  }
  return { manifest, composites, coverageSummary };
}
