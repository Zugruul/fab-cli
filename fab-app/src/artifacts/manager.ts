// Thin orchestration facade tying the injectable pieces together into the
// public surface a real caller (device wiring, out of scope here — see
// APP-029/APP-036 in docs/BACKLOG-APP.md) would use. Every dependency is an
// interface from ./types, so ArtifactManager itself stays fully
// unit-testable with the same fakes as its parts (§9.2's "background
// download support" requirement is a design/API constraint, not something
// that needs a real OS background-task scheduler to unit-test — that
// scheduling glue is native wiring that lands with the real transport
// implementation, not this module).

import type { AtomicInstaller } from "./installer";
import type { ResumableDownloader } from "./downloader";
import type { ExpectedFile, FallbackClearer, Hasher, InstallResult, ModelPackTier } from "./types";

export interface FullPackDownloadRequest {
  artifactKey: string;
  artifactName: string;
  version: string;
  /** Which model-pack tier (§14) this pack installs. When "1.7B" and a
   * fallbackClearer was wired into the manager, a successful install
   * clears any previously-persisted 1.7B load-failure fallback (BUG-199,
   * SPEC-APP.md §9.8) — a stale failure recorded against the old pack no
   * longer applies once a fresh one is on disk. Omitted or "0.6B" never
   * triggers a clear. */
  tier?: ModelPackTier;
  /** One entry per file the pack ships; each is downloaded, verified, and
   * installed together as a single atomic version. */
  files: {
    name: string;
    url: string;
    sha256: string;
  }[];
  onProgress?: (fileName: string, bytesDownloaded: number, totalBytes: number | null) => void;
  signal?: AbortSignal;
}

export class ArtifactManager {
  constructor(
    private readonly root: string,
    private readonly downloader: ResumableDownloader,
    private readonly installer: AtomicInstaller,
    private readonly hasher: Hasher,
    /** Optional so callers that never install 1.7B packs (or production
     * wiring landing incrementally) don't need to supply one — see
     * request.tier's doc comment above and the propagation contract on
     * downloadAndInstallFullPack below. */
    private readonly fallbackClearer?: FallbackClearer,
  ) {}

  /**
   * Downloads every file of a full (non-delta) pack into a staging
   * directory — each file resumable/checksum-verified independently by
   * ResumableDownloader — then installs the whole staged directory
   * atomically via AtomicInstaller. If any file's download fails (including
   * checksum mismatch), install is never attempted and the previously
   * installed version stays active.
   */
  async downloadAndInstallFullPack(request: FullPackDownloadRequest): Promise<InstallResult> {
    const stagingDir = `${this.root}/${request.artifactName}/staging/${request.version}`;

    for (const file of request.files) {
      await this.downloader.download({
        artifactKey: `${request.artifactKey}/${file.name}`,
        url: file.url,
        destPath: `${stagingDir}/${file.name}`,
        partialPath: `${stagingDir}/${file.name}.part`,
        expectedSha256: file.sha256,
        onProgress: request.onProgress
          ? (bytesDownloaded, totalBytes) => request.onProgress!(file.name, bytesDownloaded, totalBytes)
          : undefined,
        signal: request.signal,
      });
    }

    const expectedFiles: ExpectedFile[] = request.files.map((f) => ({ name: f.name, sha256: f.sha256 }));
    const result = await this.installer.install(
      this.root,
      request.artifactName,
      request.version,
      stagingDir,
      expectedFiles,
      this.hasher,
    );

    // BUG-199 (SPEC-APP.md §9.8): a fresh 1.7B install invalidates any
    // previously-persisted load-failure fallback — that flag was recorded
    // against the OLD pack, and a different one is now on disk. Only fires
    // for tier "1.7B" (a 0.6B install never touches the fallback) and only
    // when a clearer was supplied. Deliberately runs AFTER install() above
    // and is NOT wrapped in try/catch: the install itself is already
    // atomically complete and is never rolled back if clearing fails, but
    // a clearFallback failure must not be swallowed either — a silently
    // stale fallback flag pinning the user to 0.6B forever after a fixed
    // 1.7B pack ships is exactly this bug, so the error propagates to the
    // caller instead of being treated as a successful install.
    if (request.tier === "1.7B" && this.fallbackClearer) {
      await this.fallbackClearer.clearFallback();
    }

    return result;
  }

  async getCurrentVersion(artifactName: string): Promise<string | null> {
    return this.installer.getCurrentVersion(this.root, artifactName);
  }
}
