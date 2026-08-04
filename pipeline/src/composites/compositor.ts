/**
 * Renders one composite: background + each card warped onto it in paste
 * (z-)order (SPEC-APP.md §8.7b). This is the module that ties label
 * fidelity to pixels — see computeDestQuad's doc comment (geometry.ts):
 * a card's `Quad` is pushed onto the label array using the EXACT SAME
 * corners passed to warpToQuad for that card, computed independently of
 * any other card's placement or paste order, so an overlapping/occluding
 * later card can never corrupt an earlier card's own recorded ground
 * truth (see test/composites.compositor.test.ts's overlap x rotation
 * intersection tests).
 *
 * Labels are AMODAL (geometry.ts's doc comment, PR #238 review round 1):
 * a card near the canvas edge keeps its true, un-clamped quad in the
 * label even though warpToQuad only ever paints the on-canvas portion of
 * it — the label and the rendered pixels are allowed to disagree about
 * what's VISIBLE, just never about what the card's actual extent IS.
 *
 * #252 — visibleFraction & occlusion filtering: a card whose quad is
 * fully off-canvas or fully covered by a later card is still amodally
 * "real" (it has a true extent), but has ZERO legible pixels for a
 * detector to learn from. Every pasted card's visibility is tracked here
 * via a single canvas-sized `owner` array (which card index most
 * recently painted a non-transparent pixel there) plus an incremental
 * `survivingCount` per card — O(canvasWidth * canvasHeight) memory for
 * ONE array (not one per card, e.g. ~4MB as an Int32Array for a
 * 1024x1024 canvas), reused/discarded per composite, never retained
 * across a run. Because cards are processed strictly in paste order and
 * a pixel's ownership only ever transfers from an earlier index to a
 * later one, only a STRICTLY LATER card can ever reduce an earlier
 * card's visibility — an occluder painted UNDER a card never does,
 * regardless of geometric overlap (see
 * test/composites.compositor.test.ts's adversarial paste-order test).
 * Filtering itself is POST-HOC: every pasted card's pixels are painted
 * onto `canvas` unconditionally above, exactly as before #252; only the
 * returned label's `cards` array is filtered by `minVisibleFraction`
 * afterward, and `excludedCards` records how many were dropped. See
 * composites/types.ts's CompositeCardLabel doc for the full
 * visibleFraction definition, the clipping+occlusion-combined decision,
 * and the boundary conventions (inclusive `>=`, off-canvas -> 0,
 * all-excluded -> valid empty-label composite, never re-rolled).
 */
import { computeDestQuad } from "./geometry.js";
import { generateBackgroundRaw } from "./background.js";
import { warpToQuad, countCardFootprintPixels } from "./warp.js";
import { compositeOver, applyBrightnessContrast, applySleeve, applyGlare, coverFitRawImage } from "./rawImage.js";
import type { RawImage } from "./rawImage.js";
import type { CompositeParams } from "./paramStream.js";
import type { CompositeLabel, CompositeBackgroundKind, CompositeCardLabel, CardRegion, Quad } from "./types.js";

export interface LoadedCard {
  printingId: string;
  image: RawImage;
}

export interface RenderResult {
  image: RawImage;
  label: CompositeLabel;
}

/**
 * `loadedBackground` (#244) is required exactly when `params.background`
 * is external — generate.ts resolves + loads it via the same
 * getImage cache as card images before calling this. A procedural
 * background never needs it (generateBackgroundRaw is a pure function of
 * params.background alone).
 */
/** #268: output image format — controls only the label's fileName
 * extension here (compositor.ts never encodes pixels itself, see
 * imageIO.ts's "the ONLY module that touches sharp" invariant); the
 * generate.ts/cli.ts caller picks the matching encoder (encodeRawToPng vs
 * encodeRawToJpeg) so the bytes written to that fileName actually match. */
export type CompositeImageFormat = "png" | "jpeg";

export function renderComposite(
  params: CompositeParams,
  loadedCards: LoadedCard[],
  minVisibleFraction = 0,
  loadedBackground?: RawImage,
  imageFormat: CompositeImageFormat = "png",
): RenderResult {
  let canvas: RawImage;
  if (params.background.type === "external") {
    if (!loadedBackground) {
      throw new Error(
        `renderComposite: external background "${params.background.fileName}" was selected but no loaded background image was provided`,
      );
    }
    canvas = coverFitRawImage(loadedBackground, params.width, params.height);
  } else {
    canvas = generateBackgroundRaw(params.width, params.height, params.background);
  }
  const quads: Quad[] = [];
  const regions: CardRegion[] = [];
  const footprintPixels: number[] = [];
  // #253: parallel to `quads` — whether each pasted card is the official
  // card back (DECK zone), which must never appear in the label at all
  // (see types.ts's CompositeLabel.cardBacksPlaced doc).
  const isCardBackFlags: boolean[] = [];
  // #256: parallel to `quads` — whether each pasted card is a procedural
  // OCCLUDER (hand/die/stack shim) rather than a real printed card. Same
  // "rendered + occlusion bookkeeping, never labeled" shape as
  // isCardBackFlags above, but a card back and an occluder are exclusive:
  // a placement is at most one of the two (planning-time concern, not
  // enforced here — see zones/broadcastCompositor.ts).
  const isOccluderFlags: boolean[] = [];

  // #252: single canvas-sized owner-of-record array (not one mask per
  // card) — see this file's header for the memory-cost/paste-order
  // rationale. -1 means "no card currently owns this pixel".
  const owner = new Int32Array(params.width * params.height).fill(-1);
  const survivingCount: number[] = [];

  for (const placement of params.cards) {
    const loaded = loadedCards.find((c) => c.printingId === placement.printingId);
    if (!loaded) {
      throw new Error(`renderComposite: no loaded image for printingId "${placement.printingId}"`);
    }

    const aspectRatio = loaded.image.width / loaded.image.height;
    const dstQuad = computeDestQuad(params.width, params.height, aspectRatio, {
      centerXFrac: placement.centerXFrac,
      centerYFrac: placement.centerYFrac,
      rotationDeg: placement.rotationDeg,
      cardHeightFrac: placement.cardHeightFrac,
      perspectiveLeftFrac: placement.perspectiveLeftFrac,
      perspectiveRightFrac: placement.perspectiveRightFrac,
    });

    let layer = warpToQuad(loaded.image, dstQuad, params.width, params.height);
    if (placement.tags.includes("sleeved")) layer = applySleeve(layer);
    if (placement.tags.includes("glare")) layer = applyGlare(layer, placement.glarePositionFrac);

    const cardIndex = quads.length;
    footprintPixels.push(countCardFootprintPixels(loaded.image, dstQuad));
    survivingCount.push(0);
    isCardBackFlags.push(placement.isCardBack === true);
    isOccluderFlags.push(placement.isOccluder === true);
    // Binary ownership per pixel (any alpha > 0 claims it outright, no
    // partial-alpha weighting) — a small, deliberately conservative
    // approximation at antialiased quad edges: it can only ever mark a
    // semi-transparent edge pixel as fully occluded once a later card
    // touches it, never the reverse, so visibleFraction is never
    // over-stated.
    for (let p = 0; p < owner.length; p++) {
      if (layer.data[p * 4 + 3] === 0) continue;
      const prevOwner = owner[p];
      if (prevOwner !== -1) survivingCount[prevOwner]--;
      owner[p] = cardIndex;
      survivingCount[cardIndex]++;
    }

    canvas = compositeOver(canvas, layer);
    quads.push({ printingId: placement.printingId, corners: dstQuad, tags: placement.tags });
    // #256: region travels with the placement, defaulted here (not left
    // implicit) so every downstream reader of `quads[i]` — including the
    // isCardBack/isOccluder branches below, which never read this array
    // slot but keep the invariant "every quads[i] has a well-formed
    // region" true regardless — sees a real value, never undefined.
    regions.push(placement.region ?? "table");
  }

  canvas = applyBrightnessContrast(canvas, params.lighting.brightnessDelta, params.lighting.contrastDelta);

  const backgroundType: CompositeBackgroundKind = params.background.type === "external" ? "external" : `procedural:${params.background.type}`;
  const backgroundHash: string | null = params.background.type === "external" ? params.background.contentHash : null;

  // #252: post-hoc filter — every card was already painted above
  // regardless of what happens here; only the label is affected.
  // #253: a card back is categorically skipped BEFORE the visibleFraction
  // check — it is never a candidate for `includedCards`, and never counts
  // toward `excludedCards` either (that field means "would have been
  // labeled, but visibility was too low" — a card back was never eligible
  // for labeling in the first place, a different reason entirely). It was
  // still painted onto `canvas` above and still occupies `owner` for
  // occlusion purposes, exactly like any other card.
  const includedCards: CompositeCardLabel[] = [];
  let excludedCards = 0;
  let cardBacksPlaced = 0;
  for (let i = 0; i < quads.length; i++) {
    if (isCardBackFlags[i]) {
      cardBacksPlaced++;
      continue;
    }
    // #256: an occluder is categorically excluded from labeling, exactly
    // like a card back above, but counted NOWHERE (not cardBacksPlaced —
    // it isn't an official card-back asset; not excludedCards — that field
    // means "would have been labeled, but visibility was too low," and an
    // occluder was never eligible for labeling in the first place). Its
    // pixels were already painted onto `canvas` above and it already
    // participated in the `owner`/`survivingCount` occlusion bookkeeping
    // for every other card, exactly like any other placement.
    if (isOccluderFlags[i]) continue;
    const visibleFraction = footprintPixels[i] > 0 ? survivingCount[i] / footprintPixels[i] : 0;
    if (visibleFraction >= minVisibleFraction) {
      includedCards.push({ ...quads[i], visibleFraction, region: regions[i] });
    } else {
      excludedCards++;
    }
  }

  const label: CompositeLabel = {
    compositeId: params.compositeId,
    fileName: `${params.compositeId}.${imageFormat === "jpeg" ? "jpg" : "png"}`,
    width: params.width,
    height: params.height,
    backgroundType,
    backgroundHash,
    cards: includedCards,
    excludedCards,
    cardBacksPlaced,
  };

  return { image: canvas, label };
}
