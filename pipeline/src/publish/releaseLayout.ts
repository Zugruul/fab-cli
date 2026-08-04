/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): the documented versioned release
 * layout. GitHub Release assets are a FLAT namespace (no subdirectories),
 * so every naming function here returns a single flat string — the exact
 * name a release asset (and, in the local dry run, a file directly under
 * the bundle-tree root) carries.
 *
 * Convention (see README.md alongside this module for the full writeup):
 *   - release tag:            pack-<releaseVersion>
 *   - model-pack asset:       model-<tier>-<file>              (incl. its own manifest.json)
 *   - knowledge-full asset:   knowledge-full-<version>-<file>
 *   - knowledge-delta asset:  knowledge-delta-<from>-to-<to>-<file>
 *   - checksums (per release): checksums.txt (SHA256SUMS format)
 *
 * Naming is a PURE function of (tier|version, file basename) — it takes no
 * release-version argument for model packs, so a model pack's asset name
 * (and therefore its per-file download URL SHAPE) is re-derivable across
 * releases rather than requiring a release-specific index lookup. This is
 * a URL-addressing convenience ONLY — a repeated name is never evidence
 * the bytes behind it are unchanged; the app-side artifact manager
 * (fab-app/src/artifacts's AtomicInstaller, §9.2) always verifies SHA-256
 * against the manifest before installing, name reuse or not. See
 * README.md's "This is a URL-addressing convenience only" section.
 */
import type { ModelPackTier } from "./types.js";

export function modelAssetName(tier: ModelPackTier, fileBaseName: string): string {
  return `model-${tier}-${fileBaseName}`;
}

export function modelManifestAssetName(tier: ModelPackTier): string {
  return modelAssetName(tier, "manifest.json");
}

export function knowledgeFullAssetName(version: string, fileBaseName: string): string {
  return `knowledge-full-${version}-${fileBaseName}`;
}

export function knowledgeDeltaAssetName(fromVersion: string, toVersion: string, fileBaseName: string): string {
  return `knowledge-delta-${fromVersion}-to-${toVersion}-${fileBaseName}`;
}

export function releaseTag(releaseVersion: string): string {
  return `pack-${releaseVersion}`;
}

/** Second line of defense (assembleModelPack has its own earlier, named-
 * slot guard for the specific collision it can cause — this one protects
 * the write path itself against ANY caller landing two assets on the same
 * name, which would otherwise silently emit a checksums file with two
 * lines for one name, one of them wrong). Exported separately from
 * formatChecksumsFile so releasePlan.ts can run the same check BEFORE
 * copying any bytes to outDir, not just when checksums.txt gets written
 * (by which point the corrupted copy would have already happened). */
export function assertDistinctAssetNames(assetNames: string[]): void {
  const seen = new Map<string, number>();
  for (const name of assetNames) {
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(`duplicate asset name(s) would corrupt the release bundle: ${duplicates.join(", ")}`);
  }
}

export function formatChecksumsFile(assets: { assetName: string; sha256: string }[]): string {
  if (assets.length === 0) return "";
  assertDistinctAssetNames(assets.map((a) => a.assetName));

  return (
    assets
      .slice()
      .sort((a, b) => a.assetName.localeCompare(b.assetName))
      .map((a) => `${a.sha256}  ${a.assetName}`)
      .join("\n") + "\n"
  );
}
