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

/** A large, fixed, documented offset so the far mat's seed is always
 * deterministically distinct from the near mat's (never the same seed
 * twice, never re-derived from wall-clock/random state). */
const TWO_PLAYER_FAR_SEED_OFFSET = 1_000_003;

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
}

export interface GenerateZoneRunResult {
  manifest: CompositeDatasetManifest;
  composites: RenderResult[];
}

function buildEligibleByKind(cards: RawCardForSelection[], zoneMap: ZoneMap, imagesCacheDir: string): Partial<Record<SelectableZoneKind, EligibleCard[]>> {
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

  const planCommon = {
    zoneMap: input.zoneMap,
    eligibleByKind,
    cardBack,
    matWidth: input.matWidth,
    matHeight: input.matHeight,
    background: input.background,
  };

  const singlePlans = planZoneLayoutRun({ ...planCommon, config: input.config, compositesPerRun: input.singleCount, compositeIdPrefix: "composite" });
  const nearPlans = planZoneLayoutRun({ ...planCommon, config: input.config, compositesPerRun: input.twoPlayerCount, compositeIdPrefix: "two-player-near" });
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
  return { manifest, composites };
}
