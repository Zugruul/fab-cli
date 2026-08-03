/**
 * End-to-end, injectable-IO generation for one run (SPEC-APP.md §8.7b):
 * plans the run (paramStream.ts), loads each distinct source image at
 * most once (cached by path), renders every composite (compositor.ts),
 * and builds the run manifest (manifest.ts). `loadImage` is the only
 * injected side effect — tests supply a fake so this module (and its
 * determinism contract) never depends on real files or network.
 */
import { planRun } from "./paramStream.js";
import type { CardImageRef } from "./paramStream.js";
import { renderComposite } from "./compositor.js";
import type { LoadedCard, RenderResult } from "./compositor.js";
import { buildCompositeManifest } from "./manifest.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { GeneratorConfig } from "./config.js";
import type { RawImage } from "./rawImage.js";

export type LoadImageFn = (imagePath: string) => Promise<RawImage>;

export interface GenerateResult {
  manifest: CompositeDatasetManifest;
  composites: RenderResult[];
}

export async function generateDataset(
  config: GeneratorConfig,
  availableCards: CardImageRef[],
  loadImage: LoadImageFn,
  now?: () => string,
): Promise<GenerateResult> {
  const plans = planRun(config, availableCards);

  const imageCache = new Map<string, RawImage>();
  async function getImage(imagePath: string): Promise<RawImage> {
    const cached = imageCache.get(imagePath);
    if (cached) return cached;
    const loaded = await loadImage(imagePath);
    imageCache.set(imagePath, loaded);
    return loaded;
  }

  const composites: RenderResult[] = [];
  for (const plan of plans) {
    const loadedCards: LoadedCard[] = [];
    for (const cardPlacement of plan.cards) {
      loadedCards.push({ printingId: cardPlacement.printingId, image: await getImage(cardPlacement.imagePath) });
    }
    composites.push(renderComposite(plan, loadedCards));
  }

  const manifest = buildCompositeManifest({ config, labels: composites.map((c) => c.label), now });
  return { manifest, composites };
}
