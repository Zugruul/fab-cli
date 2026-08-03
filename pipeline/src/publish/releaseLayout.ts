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
 * release-version argument for model packs, so a model pack's asset names
 * (and therefore its per-file download URL) are stable across releases
 * that reuse the same underlying artifact, which is what lets the
 * app-side artifact manager's per-version file list (fab-app/src/
 * artifacts/manager.ts's FullPackDownloadRequest.files) be re-derived
 * deterministically rather than re-fetched from a release-specific index.
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

export function formatChecksumsFile(assets: { assetName: string; sha256: string }[]): string {
  if (assets.length === 0) return "";
  return (
    assets
      .slice()
      .sort((a, b) => a.assetName.localeCompare(b.assetName))
      .map((a) => `${a.sha256}  ${a.assetName}`)
      .join("\n") + "\n"
  );
}
