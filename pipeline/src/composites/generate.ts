/**
 * End-to-end, injectable-IO generation for one run (SPEC-APP.md §8.7b):
 * plans the run (paramStream.ts), loads each distinct source image at
 * most once (cached by path), renders every composite (compositor.ts),
 * and builds the run manifest (manifest.ts). `loadImage` is the only
 * injected side effect — tests supply a fake so this module (and its
 * determinism contract) never depends on real files or network.
 */
import path from "node:path";
import { planRun } from "./paramStream.js";
import type { CardImageRef } from "./paramStream.js";
import { renderComposite } from "./compositor.js";
import type { LoadedCard, RenderResult, CompositeImageFormat } from "./compositor.js";
import { buildCompositeManifest } from "./manifest.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { GeneratorConfig } from "./config.js";
import type { RawImage } from "./rawImage.js";
import type { CoverageTracker } from "./coverageTracker.js";

export type LoadImageFn = (imagePath: string) => Promise<RawImage>;

export interface GenerateResult {
  manifest: CompositeDatasetManifest;
  composites: RenderResult[];
}

/**
 * `availableBackgrounds` (#244, optional, defaults to `[]`) is the sorted
 * list of external background file names planRun draws from — see
 * paramStream.ts's planRun doc comment; this module stays agnostic about
 * where the list came from (cli.ts resolves it from config.backgroundsDir).
 * When a plan selects an external background, its file name is resolved
 * against `config.backgroundsDir` and loaded through the SAME `getImage`
 * cache as card images — a background reused across many composites in a
 * run is decoded at most once, same discipline as cards.
 *
 * `coverageTracker` (#268, optional) is threaded straight into planRun —
 * see paramStream.ts's doc comment. `imageFormat` (#268, optional, default
 * "png" — unchanged pre-#268 behavior) only affects each label's fileName
 * extension here; the caller (composites/cli.ts) is responsible for
 * picking the matching encoder when it actually writes bytes to that name.
 */
export async function generateDataset(
  config: GeneratorConfig,
  availableCards: CardImageRef[],
  loadImage: LoadImageFn,
  now?: () => string,
  availableBackgrounds: string[] = [],
  coverageTracker: CoverageTracker | null = null,
  imageFormat: CompositeImageFormat = "png",
): Promise<GenerateResult> {
  const plans = planRun(config, availableCards, availableBackgrounds, coverageTracker);

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

    let loadedBackground: RawImage | undefined;
    if (plan.background.type === "external") {
      if (!config.backgroundsDir) {
        throw new Error(
          `generateDataset: plan selected external background "${plan.background.fileName}" but config.backgroundsDir is null — ` +
            "this indicates a caller contract violation (availableBackgrounds was passed without a matching backgroundsDir)",
        );
      }
      loadedBackground = await getImage(path.join(config.backgroundsDir, plan.background.fileName));
    }

    composites.push(renderComposite(plan, loadedCards, config.minVisibleFraction, loadedBackground, imageFormat));
  }

  const manifest = buildCompositeManifest({ config, labels: composites.map((c) => c.label), now });
  return { manifest, composites };
}
