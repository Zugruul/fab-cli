// §9.2: resumable downloads (HTTP Range; persist partial-download state;
// resume after kill/restart) + SHA-256 checksum verification against the
// manifest.

import { ChecksumMismatchError } from "./errors";
import type { DownloadRecord, DownloadStateStore, DownloadTransport, FileSystem, Hasher } from "./types";

export interface DownloadArtifactOptions {
  /** Stable key identifying this transfer in the state store — one per
   * (artifact, version, file), so resume can find the right prior record. */
  artifactKey: string;
  url: string;
  /** Final path the verified file is moved to. */
  destPath: string;
  /** Scratch path the bytes are streamed into while downloading. */
  partialPath: string;
  expectedSha256: string;
  onProgress?: (bytesDownloaded: number, totalBytes: number | null) => void;
  signal?: AbortSignal;
}

export interface DownloadArtifactResult {
  path: string;
  bytesDownloaded: number;
}

export class ResumableDownloader {
  constructor(
    private readonly fs: FileSystem,
    private readonly transport: DownloadTransport,
    private readonly hasher: Hasher,
    private readonly stateStore: DownloadStateStore,
  ) {}

  async download(opts: DownloadArtifactOptions): Promise<DownloadArtifactResult> {
    const resumeFrom = await this.resolveResumePoint(opts);

    const result = await this.transport.requestRange(opts.url, resumeFrom, opts.signal);
    const totalBytes = result.totalBytes;

    let bytesDownloaded = resumeFrom;
    if (resumeFrom > 0 && !result.supportsRange) {
      // Server ignored the Range header and is sending the whole body again
      // — the partial file on disk no longer matches what's about to
      // arrive, so start clean rather than corrupt-append.
      await this.discardPartial(opts.partialPath);
      bytesDownloaded = 0;
    }

    await this.persistState(opts, bytesDownloaded, totalBytes, "in-progress");

    for await (const chunk of result.chunks) {
      await this.fs.appendFile(opts.partialPath, chunk);
      bytesDownloaded += chunk.byteLength;
      await this.persistState(opts, bytesDownloaded, totalBytes, "in-progress");
      opts.onProgress?.(bytesDownloaded, totalBytes);
    }

    const actualSha256 = await this.hasher.sha256File(opts.partialPath);
    if (actualSha256.toLowerCase() !== opts.expectedSha256.toLowerCase()) {
      // Corrupt download: never install it, and clear all resumable state
      // so the next call starts a fresh download rather than "resuming"
      // onto bad bytes.
      await this.discardPartial(opts.partialPath);
      await this.stateStore.delete(opts.artifactKey);
      throw new ChecksumMismatchError(opts.artifactKey, opts.expectedSha256, actualSha256);
    }

    await this.fs.rename(opts.partialPath, opts.destPath);
    await this.stateStore.delete(opts.artifactKey);

    return { path: opts.destPath, bytesDownloaded };
  }

  /** Figures out where to resume from: only trusts the persisted record if
   * it's for the same URL/checksum AND the partial file on disk actually
   * has exactly that many bytes (defends against the state store and the
   * filesystem disagreeing after an unclean kill). */
  private async resolveResumePoint(opts: DownloadArtifactOptions): Promise<number> {
    const record = await this.stateStore.get(opts.artifactKey);
    if (
      record &&
      record.status === "in-progress" &&
      record.url === opts.url &&
      record.expectedSha256.toLowerCase() === opts.expectedSha256.toLowerCase() &&
      record.partialFilePath === opts.partialPath
    ) {
      const stat = await this.fs.stat(opts.partialPath);
      if (stat && stat.size === record.bytesDownloaded) {
        return record.bytesDownloaded;
      }
    }
    await this.discardPartial(opts.partialPath);
    return 0;
  }

  private async discardPartial(partialPath: string): Promise<void> {
    if (await this.fs.exists(partialPath)) {
      await this.fs.deleteFile(partialPath);
    }
  }

  private async persistState(
    opts: DownloadArtifactOptions,
    bytesDownloaded: number,
    totalBytes: number | null,
    status: DownloadRecord["status"],
  ): Promise<void> {
    await this.stateStore.set({
      artifactKey: opts.artifactKey,
      url: opts.url,
      partialFilePath: opts.partialPath,
      bytesDownloaded,
      totalBytes,
      expectedSha256: opts.expectedSha256,
      status,
      updatedAt: new Date().toISOString(),
    });
  }
}
