import { ChecksumMismatchError } from "../errors";
import { ResumableDownloader } from "../downloader";
import {
  FakeDownloadStateStore,
  FakeFileSystem,
  FakeTransport,
  NodeCryptoHasher,
  sha256Hex,
} from "./testDoubles";

function contentBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("ResumableDownloader", () => {
  it("persists progress and resumes with a byte-range request after a simulated kill mid-download", async () => {
    const content = contentBytes("the quick brown fox jumps over the lazy dog"); // 44 bytes
    const expectedSha256 = sha256Hex(content);

    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    // Fails partway through the first attempt (after ~20 bytes), then a
    // reconnect on the SAME downloader succeeds — the transport only kills
    // its first call, mirroring "process gets killed, app relaunches,
    // download resumes."
    const transport = new FakeTransport(content, { chunkSize: 5, failAtByteOnFirstCall: 20 });
    const downloader = new ResumableDownloader(fs, transport, hasher, stateStore);

    const opts = {
      artifactKey: "model-pack/1.0.0/weights.gguf",
      url: "https://artifacts.example/weights.gguf",
      destPath: "/artifacts/weights.gguf",
      partialPath: "/artifacts/weights.gguf.part",
      expectedSha256,
    };

    await expect(downloader.download(opts)).rejects.toThrow("simulated connection kill mid-download");

    // The kill left real, partial progress on disk and in the state store —
    // this is what makes resume possible after an actual process restart.
    const partialAfterKill = fs.files.get(opts.partialPath);
    expect(partialAfterKill).toBeDefined();
    expect(partialAfterKill!.byteLength).toBeGreaterThan(0);
    expect(partialAfterKill!.byteLength).toBeLessThan(content.byteLength);

    const recordAfterKill = await stateStore.get(opts.artifactKey);
    expect(recordAfterKill).not.toBeNull();
    expect(recordAfterKill!.status).toBe("in-progress");
    expect(recordAfterKill!.bytesDownloaded).toBe(partialAfterKill!.byteLength);

    // Simulate app relaunch: a brand-new downloader instance over the same
    // (persisted) fs + state store — nothing in-memory survives except what
    // was actually written to those two stores.
    const resumedDownloader = new ResumableDownloader(fs, transport, hasher, stateStore);
    const result = await resumedDownloader.download(opts);

    // The second requestRange call must have asked for bytes starting
    // exactly where the kill left off — not byte 0 (that would be a silent
    // full re-download, not a resume).
    expect(transport.rangeStartCalls).toEqual([0, recordAfterKill!.bytesDownloaded]);

    expect(result.path).toBe(opts.destPath);
    const finalBytes = fs.files.get(opts.destPath);
    expect(finalBytes).toBeDefined();
    expect(Buffer.from(finalBytes!).toString()).toBe(Buffer.from(content).toString());
    expect(fs.files.has(opts.partialPath)).toBe(false);
    expect(await stateStore.get(opts.artifactKey)).toBeNull();
  });

  it("re-downloads from scratch when the completed transfer fails checksum verification", async () => {
    const goodContent = contentBytes("correct artifact bytes");
    const corruptedTransportContent = contentBytes("CORRUPTED artifact byte!"); // wrong bytes, same-ish length
    const expectedSha256 = sha256Hex(goodContent);

    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    // First attempt "succeeds" at the transport level but delivers corrupt
    // bytes (e.g. a truncated/garbled transfer that still completed).
    const badTransport = new FakeTransport(corruptedTransportContent, { chunkSize: 6 });
    const downloader = new ResumableDownloader(fs, badTransport, hasher, stateStore);

    const opts = {
      artifactKey: "knowledge-pack/1.0.0/chunks.sqlite",
      url: "https://artifacts.example/chunks.sqlite",
      destPath: "/artifacts/chunks.sqlite",
      partialPath: "/artifacts/chunks.sqlite.part",
      expectedSha256,
    };

    await expect(downloader.download(opts)).rejects.toThrow(ChecksumMismatchError);

    // Corrupt bytes must never be installed at destPath, and both the
    // partial file and resumable state must be cleared so a retry starts a
    // genuinely fresh download rather than "resuming" onto bad data.
    expect(fs.files.has(opts.destPath)).toBe(false);
    expect(fs.files.has(opts.partialPath)).toBe(false);
    expect(await stateStore.get(opts.artifactKey)).toBeNull();

    // Retry against a transport that now serves the correct bytes.
    const goodTransport = new FakeTransport(goodContent, { chunkSize: 6 });
    const retryDownloader = new ResumableDownloader(fs, goodTransport, hasher, stateStore);
    const result = await retryDownloader.download(opts);

    expect(goodTransport.rangeStartCalls).toEqual([0]); // fresh start, not a resume
    expect(result.path).toBe(opts.destPath);
    expect(Buffer.from(fs.files.get(opts.destPath)!).toString()).toBe(Buffer.from(goodContent).toString());
  });

  it("does not resume from a stale state-store record whose byte count disagrees with the file actually on disk", async () => {
    const content = contentBytes("abcdefghijklmnopqrstuvwxyz");
    const expectedSha256 = sha256Hex(content);

    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    const transport = new FakeTransport(content, { chunkSize: 5 });
    const downloader = new ResumableDownloader(fs, transport, hasher, stateStore);

    const opts = {
      artifactKey: "artifact-x",
      url: "https://artifacts.example/x",
      destPath: "/artifacts/x",
      partialPath: "/artifacts/x.part",
      expectedSha256,
    };

    // A state-store record claims 10 bytes downloaded, but no partial file
    // exists on disk at all (e.g. the app was reinstalled, or the file was
    // evicted by the OS while the tiny state record survived).
    await stateStore.set({
      artifactKey: opts.artifactKey,
      url: opts.url,
      partialFilePath: opts.partialPath,
      bytesDownloaded: 10,
      totalBytes: content.byteLength,
      expectedSha256,
      status: "in-progress",
      updatedAt: new Date(0).toISOString(),
    });

    await downloader.download(opts);

    expect(transport.rangeStartCalls).toEqual([0]);
    expect(Buffer.from(fs.files.get(opts.destPath)!).toString()).toBe(Buffer.from(content).toString());
  });
});
