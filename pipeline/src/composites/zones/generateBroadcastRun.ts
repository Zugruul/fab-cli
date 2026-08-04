/**
 * End-to-end, injectable-IO generation for one `--mode broadcast` run
 * (#256 Phase C) — the broadcast analog of generateZoneRun.ts's
 * generateZoneRun, reusing that file's exported `buildEligibleByKind` and
 * `ImageNeed` wholesale (no reimplementation) plus planZoneLayoutRun
 * UNCHANGED for the near/far mats. Layers three broadcast-only steps on
 * top: planBroadcastAugmentationRun + applyBroadcastAugmentation (sleeve/
 * stack/dice/hand/preview/keystone), mergeBroadcastTableRenders
 * (landscape, vertical-mirror-axis table), and renderBroadcastFrame (the
 * measured chrome/play-area frame). Returns a {manifest, composites}
 * shape identical to generate.ts's/generateZoneRun.ts's own, so it flows
 * unchanged into write.ts/sampleSheet.ts.
 */
import { configHash } from "../../qa/manifest.js";
import { sha256 } from "../../benchmark/manifest.js";
import { createSolidImage } from "../rawImage.js";
import type { RawImage } from "../rawImage.js";
import { renderComposite } from "../compositor.js";
import type { LoadedCard } from "../compositor.js";
import { planZoneLayoutRun } from "./planZoneLayout.js";
import type { ZoneLayoutConfig } from "./planZoneLayout.js";
import { planBroadcastAugmentationRun } from "./planBroadcastAugmentation.js";
import type { BroadcastAugmentationConfig } from "./planBroadcastAugmentation.js";
import { applyBroadcastAugmentation } from "./applyBroadcastAugmentation.js";
import { mergeBroadcastTableRenders } from "./twoPlayer.js";
import { renderBroadcastFrame } from "./broadcastCompositor.js";
import type { RenderBroadcastFrameResult } from "./broadcastCompositor.js";
import { createStackShimImage, createDiceImage, createHandImage } from "./broadcastOccluders.js";
import { pickDeterministic } from "./semanticSelection.js";
import type { RawCardForSelection } from "./semanticSelection.js";
import { buildEligibleByKind } from "./generateZoneRun.js";
import type { ImageNeed } from "./generateZoneRun.js";
import type { ZoneMap } from "./zoneMap.js";
import type { BroadcastLayoutConfig } from "./broadcastLayout.js";
import { COMPOSITE_LABEL_SCHEMA_VERSION } from "../types.js";
import { COMPOSITE_MANIFEST_SCHEMA_VERSION } from "../manifest.js";
import type { CompositeDatasetManifest, CompositeManifestEntry } from "../manifest.js";

/** Large, fixed, documented offsets (mirrors generateZoneRun.ts's
 * TWO_PLAYER_NEAR_SEED_OFFSET/TWO_PLAYER_FAR_SEED_OFFSET exactly) — keeps
 * the left and right mats' zone-layout rng streams distinct from each
 * other AND from the base zoneLayoutConfig.seed itself, off the SAME
 * shared config/zone map (both players sit at an identical physical
 * layout). The broadcast augmentation stream (sleeve/stack/dice/hand/
 * preview/keystone) is a wholly separate top-level config object with its
 * OWN seed field — no offset needed there, see
 * planBroadcastAugmentation.ts's header. */
export const BROADCAST_LEFT_SEED_OFFSET = 2_000_003;
export const BROADCAST_RIGHT_SEED_OFFSET = 3_000_017;

/** Fixed, not drawn from any rng stream (#256 scope decision): the
 * measured broadcast-layout config's chrome + play area together cover
 * essentially the entire frame (Phase B), so the raw "outside everything"
 * background is barely, if ever, visible — a single flat dark backdrop is
 * sufficient rather than adding a whole extra procedural-background rng
 * dimension for content that's mostly painted over anyway. */
const FRAME_BACKGROUND_COLOR: [number, number, number] = [12, 12, 16];

export interface GenerateBroadcastRunInput {
  zoneLayoutConfig: ZoneLayoutConfig;
  augmentationConfig: BroadcastAugmentationConfig;
  layout: BroadcastLayoutConfig;
  zoneMap: ZoneMap;
  cards: RawCardForSelection[];
  imagesCacheDir: string;
  loadImage: (imagePath: string) => Promise<RawImage>;
  ensureImagesDownloaded: (needs: ImageNeed[]) => Promise<void>;
  loadedBackground: RawImage;
  cardBackImagePath: string;
  cardBackPrintingId: string;
  matWidth: number;
  matHeight: number;
  background: { fileName: string; contentHash: string };
  frameWidth: number;
  frameHeight: number;
  count: number;
  now?: () => string;
}

export interface GenerateBroadcastRunResult {
  manifest: CompositeDatasetManifest;
  composites: RenderBroadcastFrameResult[];
}

function pad(i: number): string {
  return String(i).padStart(4, "0");
}

export async function generateBroadcastRun(input: GenerateBroadcastRunInput): Promise<GenerateBroadcastRunResult> {
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

  const leftPlans = planZoneLayoutRun({
    ...planCommon,
    config: { ...input.zoneLayoutConfig, seed: input.zoneLayoutConfig.seed + BROADCAST_LEFT_SEED_OFFSET },
    compositesPerRun: input.count,
    compositeIdPrefix: "broadcast-left",
  });
  const rightPlans = planZoneLayoutRun({
    ...planCommon,
    config: { ...input.zoneLayoutConfig, seed: input.zoneLayoutConfig.seed + BROADCAST_RIGHT_SEED_OFFSET },
    compositesPerRun: input.count,
    compositeIdPrefix: "broadcast-right",
  });
  const augmentations = planBroadcastAugmentationRun(input.augmentationConfig, input.zoneMap, input.count);

  // "Any card" pool for the card-preview panel pick — reuses the SAME
  // pitch-kind eligibility pool already computed above (pitch matches any
  // catalog card, semanticSelection.ts), no new eligibility concept.
  const previewPool = eligibleByKind.pitch;
  if (!previewPool || previewPool.length === 0) {
    throw new Error("generateBroadcastRun: no eligible cards for the card-preview panel (pitch-kind pool is empty)");
  }

  const applied = leftPlans.map((leftPlan, i) => applyBroadcastAugmentation(leftPlan, rightPlans[i], input.zoneMap, augmentations[i]));
  const previewPicks = augmentations.map((a) => pickDeterministic(previewPool, a.previewCardDraw));

  // Every distinct REAL catalog printing actually picked, across every
  // composite's left/right plans AND every preview pick — deliberately
  // excludes isCardBack (has its own dedicated fetch, ensureCardBackCached)
  // and isOccluder placements (procedurally generated, never downloaded).
  const imageUrlByPrintingId = new Map<string, string>();
  for (const pool of Object.values(eligibleByKind)) {
    for (const c of pool ?? []) imageUrlByPrintingId.set(c.printingId, c.imageUrl);
  }
  const needsByPrintingId = new Map<string, ImageNeed>();
  for (const { leftPlan, rightPlan } of applied) {
    for (const c of [...leftPlan.cards, ...rightPlan.cards]) {
      if (c.isCardBack || c.isOccluder) continue;
      const imageUrl = imageUrlByPrintingId.get(c.printingId);
      if (imageUrl) needsByPrintingId.set(c.printingId, { printingId: c.printingId, imagePath: c.imagePath, imageUrl });
    }
  }
  for (const pick of previewPicks) {
    needsByPrintingId.set(pick.printingId, { printingId: pick.printingId, imagePath: pick.imagePath, imageUrl: pick.imageUrl });
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

  const frameBackground = createSolidImage(input.frameWidth, input.frameHeight, FRAME_BACKGROUND_COLOR);

  const composites: RenderBroadcastFrameResult[] = [];
  for (let i = 0; i < input.count; i++) {
    const { leftPlan, rightPlan, occluderSpecs } = applied[i];

    // Occluder images are regenerated FRESH per composite (never cached
    // across composites): applyBroadcastAugmentation resets its synthetic
    // printingId counters (e.g. "__occluder_dice_0__") independently for
    // EACH composite, so the same printingId can legitimately map to
    // different visual content (a different face/color) across different
    // composites — a run-wide cache keyed only by printingId would
    // silently reuse composite 0's dice image for composite 1's.
    const occluderImages = new Map<string, RawImage>();
    for (const spec of occluderSpecs) {
      if (spec.kind === "shim") occluderImages.set(spec.printingId, createStackShimImage(spec.width, spec.height, spec.color));
      else if (spec.kind === "dice") occluderImages.set(spec.printingId, createDiceImage(spec.width, spec.height, spec.bodyColor, spec.pipColor, spec.face));
      else occluderImages.set(spec.printingId, createHandImage(spec.width, spec.height, spec.skinTone));
    }

    async function loadCardsForPlan(plan: { cards: { printingId: string; imagePath: string; isOccluder?: boolean }[] }): Promise<LoadedCard[]> {
      const out: LoadedCard[] = [];
      for (const c of plan.cards) {
        const image = c.isOccluder ? occluderImages.get(c.printingId)! : await getImage(c.imagePath);
        out.push({ printingId: c.printingId, image });
      }
      return out;
    }

    const leftLoaded = await loadCardsForPlan(leftPlan);
    const rightLoaded = await loadCardsForPlan(rightPlan);
    const leftRender = renderComposite(leftPlan, leftLoaded, input.zoneLayoutConfig.minVisibleFraction, input.loadedBackground);
    const rightRender = renderComposite(rightPlan, rightLoaded, input.zoneLayoutConfig.minVisibleFraction, input.loadedBackground);
    const merged = mergeBroadcastTableRenders(leftRender, rightRender, `broadcast-table-${pad(i)}`);

    const previewRef = previewPicks[i];
    const previewImage = await getImage(previewRef.imagePath);

    const frame = renderBroadcastFrame({
      frameWidth: input.frameWidth,
      frameHeight: input.frameHeight,
      frameBackground,
      layout: input.layout,
      tableImage: merged.image,
      tableCardLabels: merged.label.cards,
      keystoneLeftFrac: augmentations[i].keystoneLeftFrac,
      keystoneRightFrac: augmentations[i].keystoneRightFrac,
      previewCard: { printingId: previewRef.printingId, image: previewImage },
      compositeId: `broadcast-${pad(i)}`,
      excludedCards: merged.label.excludedCards,
      cardBacksPlaced: merged.label.cardBacksPlaced,
      backgroundType: "procedural:solid",
      backgroundHash: null,
    });
    composites.push(frame);
  }

  const now = input.now ?? (() => new Date().toISOString());
  const manifestEntries: CompositeManifestEntry[] = composites.map((c) => ({
    compositeId: c.label.compositeId,
    fileName: c.label.fileName,
    cardCount: c.label.cards.length,
    excludedCards: c.label.excludedCards,
    cardBacksPlaced: c.label.cardBacksPlaced,
    labelFileHash: sha256(Buffer.from(JSON.stringify(c.label, null, 2) + "\n")),
  }));
  const manifest: CompositeDatasetManifest = {
    schemaVersion: COMPOSITE_MANIFEST_SCHEMA_VERSION,
    labelSchemaVersion: COMPOSITE_LABEL_SCHEMA_VERSION,
    buildDate: now(),
    seed: input.zoneLayoutConfig.seed,
    generatorConfigHash: configHash({ zoneLayoutConfig: input.zoneLayoutConfig, augmentationConfig: input.augmentationConfig, layout: input.layout }),
    compositeCount: composites.length,
    composites: manifestEntries,
  };

  return { manifest, composites };
}
