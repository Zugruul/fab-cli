// Shared in-memory fakes for the artifact-manager test suite. No real
// filesystem or network call happens anywhere in here — everything is a
// deterministic, inspectable stand-in for the injectable interfaces in
// ../types.ts, per SPEC-APP.md §9.2's "ABSTRACT the transport+fs behind
// injectable interfaces so ALL logic is unit-testable with mocks" mandate.
//
// This file intentionally contains no fab-app runtime/production logic —
// it exists to make the *.test.ts files in this directory runnable.

import { createHash } from "crypto";
import type {
  ArtifactDisabledStateStore,
  ArtifactHost,
  ArtifactVersionRef,
  DownloadRecord,
  DownloadStateStore,
  DownloadTransport,
  FileStat,
  FileSystem,
  Hasher,
  RangeRequestResult,
} from "../types";

export class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>([""]);

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    this.dirs.add(path);
  }

  async stat(path: string): Promise<FileStat | null> {
    const data = this.files.get(path);
    return data ? { size: data.byteLength } : null;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT: ${path}`);
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async appendFile(path: string, data: Uint8Array): Promise<void> {
    const existing = this.files.get(path) ?? new Uint8Array(0);
    const merged = new Uint8Array(existing.byteLength + data.byteLength);
    merged.set(existing, 0);
    merged.set(data, existing.byteLength);
    this.files.set(path, merged);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    if (this.files.has(fromPath)) {
      this.files.set(toPath, this.files.get(fromPath)!);
      this.files.delete(fromPath);
      return;
    }
    if (this.dirs.has(fromPath) || this.hasDescendants(fromPath)) {
      const prefix = `${fromPath}/`;
      for (const [path, data] of [...this.files.entries()]) {
        if (path.startsWith(prefix)) {
          this.files.set(`${toPath}/${path.slice(prefix.length)}`, data);
          this.files.delete(path);
        }
      }
      this.dirs.delete(fromPath);
      this.dirs.add(toPath);
      return;
    }
    throw new Error(`ENOENT (rename source missing): ${fromPath}`);
  }

  async copyFile(fromPath: string, toPath: string): Promise<void> {
    const data = this.files.get(fromPath);
    if (!data) throw new Error(`ENOENT (copy source missing): ${fromPath}`);
    this.files.set(toPath, data);
  }

  async readDir(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
    }
    return [...names];
  }

  private hasDescendants(path: string): boolean {
    const prefix = `${path}/`;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  }
}

export class NodeCryptoHasher implements Hasher {
  constructor(private readonly fs: FakeFileSystem) {}

  async sha256File(path: string): Promise<string> {
    const data = await this.fs.readFile(path);
    return createHash("sha256").update(data).digest("hex");
  }
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface FakeTransportOptions {
  chunkSize?: number;
  /** Server ignores Range and always sends the full body from byte 0. */
  supportsRange?: boolean;
  /** Throws once the cumulative absolute byte position reaches this value,
   * but only on the FIRST call to requestRange — simulates a connection
   * drop / process kill mid-stream that then succeeds on retry/resume. */
  failAtByteOnFirstCall?: number;
}

export class FakeTransport implements DownloadTransport {
  readonly rangeStartCalls: number[] = [];
  private callCount = 0;

  constructor(
    private readonly content: Uint8Array,
    private readonly opts: FakeTransportOptions = {},
  ) {}

  async requestRange(
    _url: string,
    rangeStartByte: number,
    _signal?: AbortSignal,
  ): Promise<RangeRequestResult> {
    this.rangeStartCalls.push(rangeStartByte);
    const isFirstCall = this.callCount === 0;
    this.callCount += 1;

    const chunkSize = this.opts.chunkSize ?? 4;
    const supportsRange = this.opts.supportsRange ?? true;
    const startByte = supportsRange ? rangeStartByte : 0;
    const slice = this.content.slice(startByte);
    const totalBytes = this.content.byteLength;
    const failAtByte = isFirstCall ? this.opts.failAtByteOnFirstCall : undefined;

    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      let position = startByte;
      for (let i = 0; i < slice.length; i += chunkSize) {
        if (failAtByte !== undefined && position >= failAtByte) {
          throw new Error("simulated connection kill mid-download");
        }
        const chunk = slice.slice(i, i + chunkSize);
        yield chunk;
        position += chunk.byteLength;
      }
    })();

    return {
      statusCode: supportsRange && rangeStartByte > 0 ? 206 : 200,
      totalBytes,
      supportsRange,
      chunks,
    };
  }
}

export class FakeDownloadStateStore implements DownloadStateStore {
  readonly records = new Map<string, DownloadRecord>();

  async get(artifactKey: string): Promise<DownloadRecord | null> {
    return this.records.get(artifactKey) ?? null;
  }

  async set(record: DownloadRecord): Promise<void> {
    this.records.set(record.artifactKey, { ...record });
  }

  async delete(artifactKey: string): Promise<void> {
    this.records.delete(artifactKey);
  }
}

export class FakeArtifactDisabledStateStore implements ArtifactDisabledStateStore {
  readonly disabled: { artifactName: string; version: string; reason: string }[] = [];

  async markDisabled(artifactName: string, version: string, reason: string): Promise<void> {
    this.disabled.push({ artifactName, version, reason });
  }
}

export class FakeArtifactHost implements ArtifactHost {
  constructor(private readonly versionsByArtifact: Map<string, ArtifactVersionRef[]>) {}

  async listAvailableVersions(artifactName: string): Promise<ArtifactVersionRef[]> {
    return this.versionsByArtifact.get(artifactName) ?? [];
  }
}
