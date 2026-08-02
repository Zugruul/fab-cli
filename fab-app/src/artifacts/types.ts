// APP-031: injectable interfaces the artifact manager is built against.
//
// Nothing in this file talks to a real filesystem or network. Production
// wiring (react-native-blob-util or expo-file-system for transport+fs, a
// native streaming SHA-256 for Hasher, AsyncStorage/MMKV for the state
// stores) lives outside src/artifacts and is not part of this task — see
// SPEC-APP.md §9.2. Every class in this directory is constructed with these
// interfaces so unit tests can supply deterministic in-memory fakes instead
// (fab-app/src/artifacts/__tests__/testDoubles.ts).

import type { ModelPackTier, RevocationList, Tombstones } from "@fab/manifest-schema";

export interface FileStat {
  size: number;
}

export interface FileSystem {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Appends `data` to the file at `path`, creating it if absent. */
  appendFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Must be atomic when `fromPath`/`toPath` are on the same volume — the
   * property every atomic-swap guarantee in this module is built on. */
  rename(fromPath: string, toPath: string): Promise<void>;
  copyFile(fromPath: string, toPath: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
}

/** Streaming-capable SHA-256 over a file path — kept separate from
 * FileSystem so a real implementation can hash without loading the whole
 * file into JS memory (model packs run 100s of MB–GBs). */
export interface Hasher {
  sha256File(path: string): Promise<string>;
}

export interface RangeRequestResult {
  statusCode: number;
  /** Total resource size if known (Content-Length for 200, parsed
   * Content-Range total for 206). Null when the server doesn't report it. */
  totalBytes: number | null;
  /** True when the server actually honored the byte-range request (206
   * with a matching Content-Range) rather than restarting from byte 0. */
  supportsRange: boolean;
  chunks: AsyncIterable<Uint8Array>;
}

export interface DownloadTransport {
  requestRange(
    url: string,
    rangeStartByte: number,
    signal?: AbortSignal,
  ): Promise<RangeRequestResult>;
}

export type DownloadStatus = "in-progress" | "complete";

/** Persisted resumable-download state — must survive process kill/restart
 * (backed by disk on device, e.g. MMKV/AsyncStorage; in-memory in tests). */
export interface DownloadRecord {
  artifactKey: string;
  url: string;
  partialFilePath: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  expectedSha256: string;
  status: DownloadStatus;
  updatedAt: string;
}

export interface DownloadStateStore {
  get(artifactKey: string): Promise<DownloadRecord | null>;
  set(record: DownloadRecord): Promise<void>;
  delete(artifactKey: string): Promise<void>;
}

export interface ExpectedFile {
  name: string;
  sha256: string;
}

export interface InstallResult {
  version: string;
  installDir: string;
}

/** One available version of an artifact on the configured host, as needed
 * to pick "the newest non-revoked version" (§9.5). */
export interface ArtifactVersionRef {
  artifact: string;
  version: string;
  manifestUrl: string;
  downloadUrl: string;
}

export interface ArtifactHost {
  listAvailableVersions(artifactName: string): Promise<ArtifactVersionRef[]>;
}

export interface InstalledArtifactRecord {
  artifactName: string;
  version: string;
}

export type RevocationAction =
  | {
      kind: "disable-and-redownload";
      artifactName: string;
      revokedVersion: string;
      reason: string;
      nextVersion: ArtifactVersionRef;
    }
  | {
      kind: "disable-no-replacement";
      artifactName: string;
      revokedVersion: string;
      reason: string;
    };

/** User-notified "this artifact is disabled" state (§9.5) — separate from
 * DownloadStateStore because it persists across the redownload that
 * follows, not just for the duration of one transfer. */
export interface ArtifactDisabledStateStore {
  markDisabled(artifactName: string, version: string, reason: string): Promise<void>;
}

/** Narrow structural view of src/lifecycle/types.ts's TierFallbackStore —
 * declared here (rather than importing that type) so src/artifacts never
 * depends on src/lifecycle; TierFallbackStore satisfies this structurally.
 * BUG-199 (SPEC-APP.md §9.8): production wiring passes the same store
 * instance to both modules' constructors so a fresh 1.7B install can clear
 * a load-failure fallback that was recorded against the old pack. */
export interface FallbackClearer {
  clearFallback(): Promise<void>;
}

export type { ModelPackTier, RevocationList, Tombstones };
