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
import type { ExpectedFile, Hasher, InstallResult } from "./types";

export interface FullPackDownloadRequest {
  artifactKey: string;
  artifactName: string;
  version: string;
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
    return this.installer.install(
      this.root,
      request.artifactName,
      request.version,
      stagingDir,
      expectedFiles,
      this.hasher,
    );
  }

  async getCurrentVersion(artifactName: string): Promise<string | null> {
    return this.installer.getCurrentVersion(this.root, artifactName);
  }
}
