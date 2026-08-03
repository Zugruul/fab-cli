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
 */
import { computeDestQuad } from "./geometry.js";
import { generateBackgroundRaw } from "./background.js";
import { warpToQuad } from "./warp.js";
import { compositeOver, applyBrightnessContrast, applySleeve, applyGlare } from "./rawImage.js";
import type { RawImage } from "./rawImage.js";
import type { CompositeParams } from "./paramStream.js";
import type { CompositeLabel, Quad } from "./types.js";

export interface LoadedCard {
  printingId: string;
  image: RawImage;
}

export interface RenderResult {
  image: RawImage;
  label: CompositeLabel;
}

export function renderComposite(params: CompositeParams, loadedCards: LoadedCard[]): RenderResult {
  let canvas = generateBackgroundRaw(params.width, params.height, params.background);
  const quads: Quad[] = [];

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

    canvas = compositeOver(canvas, layer);
    quads.push({ printingId: placement.printingId, corners: dstQuad, tags: placement.tags });
  }

  canvas = applyBrightnessContrast(canvas, params.lighting.brightnessDelta, params.lighting.contrastDelta);

  const label: CompositeLabel = {
    compositeId: params.compositeId,
    fileName: `${params.compositeId}.png`,
    width: params.width,
    height: params.height,
    backgroundType: params.background.type,
    cards: quads,
  };

  return { image: canvas, label };
}
