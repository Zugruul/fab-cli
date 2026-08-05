/**
 * End-to-end, injectable-IO generation for one run (SPEC-APP.md §8.7b):
 * plans the run (paramStream.ts), loads each distinct source image
 * (cached by path, LRU-bounded, see below), renders every composite
 * (compositor.ts) and hands it to `onComposite` immediately, then builds
 * the run manifest (manifest.ts) from labels alone. `loadImage` is the
 * only injected side effect — tests supply a fake so this module (and its
 * determinism contract) never depends on real files or network.
 *
 * #272: this module used to accumulate every rendered composite (full
 * canvas pixels, not just the label) into a `composites: RenderResult[]`
 * array and return it, and cached every decoded source image in an
 * unbounded `Map` for the whole run's lifetime. Coverage mode
 * deliberately visits nearly every distinct printing in the catalog, so
 * that Map alone grew to hold ~16k decoded card images (some ~12MB each,
 * real high-res scans) — the dominant driver of the measured
 * ~11MB/composite unbounded RSS growth that SIGKILLed a 20,700-composite
 * run before it wrote a single file. Both are fixed here: `onComposite`
 * is now a required per-composite sink (composites/cli.ts wires it to
 * write.ts's streaming `beginCompositeRun`, so a composite's pixels never
 * outlive the call that produced them) and the image cache is bounded by
 * `imageCacheSize` via lruCache.ts, evicting the least-recently-used
 * decoded image once at capacity. Only `labels` — small JSON, not
 * pixels — are accumulated across the whole run, because
 * buildCompositeManifest needs every label to compute the manifest; that
 * is the one thing genuinely O(composites) here, and it's cheap (a few KB
 * per composite, not megabytes).
 */
import path from "node:path";
import { planRun } from "./paramStream.js";
import type { CardImageRef } from "./paramStream.js";
import { renderComposite } from "./compositor.js";
import type { LoadedCard, RenderResult, CompositeImageFormat } from "./compositor.js";
import { buildCompositeManifest } from "./manifest.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { CompositeLabel } from "./types.js";
import type { GeneratorConfig } from "./config.js";
import type { RawImage } from "./rawImage.js";
import type { CoverageTracker } from "./coverageTracker.js";
import { LruCache } from "./lruCache.js";

export type LoadImageFn = (imagePath: string) => Promise<RawImage>;

/** Invoked once per composite, immediately after it's rendered, in plan
 * order. May be async (e.g. write.ts's beginCompositeRun encodes + writes
 * to disk); generateDataset awaits it before rendering the next composite,
 * so at most one composite's pixels are ever alive at a time (#272). */
export type OnComposite = (result: RenderResult) => void | Promise<void>;

export interface GenerateResult {
  manifest: CompositeDatasetManifest;
}

/** Default LRU capacity for the decoded-source-image cache (#272) — large
 * enough that a normal-sized non-coverage run (config.compositesPerRun in
 * the tens to low hundreds, cardsPerComposite up to a handful) sees no
 * extra reloads versus the old unbounded cache, small enough to keep peak
 * cache memory bounded (worst case real card scans decode to low tens of
 * MB each) on a coverage run that touches the full ~16k-printing catalog. */
export const DEFAULT_IMAGE_CACHE_SIZE = 64;

/**
 * `availableBackgrounds` (#244, optional, defaults to `[]`) is the sorted
 * list of external background file names planRun draws from — see
 * paramStream.ts's planRun doc comment; this module stays agnostic about
 * where the list came from (cli.ts resolves it from config.backgroundsDir).
 * When a plan selects an external background, its file name is resolved
 * against `config.backgroundsDir` and loaded through the SAME `getImage`
 * cache as card images — a background reused across many composites in a
 * run is decoded at most once (cache size permitting), same discipline as
 * cards.
 *
 * `coverageTracker` (#268, optional) is threaded straight into planRun —
 * see paramStream.ts's doc comment. `imageFormat` (#268, optional, default
 * "png" — unchanged pre-#268 behavior) only affects each label's fileName
 * extension here; the caller (composites/cli.ts) is responsible for
 * picking the matching encoder when it actually writes bytes to that name.
 *
 * `imageCacheSize` (#272, optional, default DEFAULT_IMAGE_CACHE_SIZE) is
 * deliberately NOT part of GeneratorConfig: it's a runtime memory/
 * performance knob, not a generation-semantics one — the rng stream, the
 * plan, and every rendered pixel are entirely independent of it, so
 * changing it must never change generatorConfigHash or any composite's
 * output (verified by test/composites.generate.test.ts's determinism
 * suite, which fixes it across both runs it compares).
 */
export async function generateDataset(
  config: GeneratorConfig,
  availableCards: CardImageRef[],
  loadImage: LoadImageFn,
  onComposite: OnComposite,
  now?: () => string,
  availableBackgrounds: string[] = [],
  coverageTracker: CoverageTracker | null = null,
  imageFormat: CompositeImageFormat = "png",
  imageCacheSize: number = DEFAULT_IMAGE_CACHE_SIZE,
): Promise<GenerateResult> {
  const plans = planRun(config, availableCards, availableBackgrounds, coverageTracker);

  const imageCache = new LruCache<string, RawImage>(imageCacheSize);
  async function getImage(imagePath: string): Promise<RawImage> {
    const cached = imageCache.get(imagePath);
    if (cached) return cached;
    const loaded = await loadImage(imagePath);
    imageCache.set(imagePath, loaded);
    return loaded;
  }

  const labels: CompositeLabel[] = [];
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

    const result = renderComposite(plan, loadedCards, config.minVisibleFraction, loadedBackground, imageFormat);
    labels.push(result.label);
    // Awaited before the next iteration renders — exactly one composite's
    // pixels alive at a time (#272; see test/composites.generate.test.ts's
    // "never holds more than one rendered composite in memory at a time").
    await onComposite(result);
  }

  const manifest = buildCompositeManifest({ config, labels, now });
  return { manifest };
}
