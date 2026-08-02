import { ResumableDownloader } from "../downloader";
import { AtomicInstaller } from "../installer";
import { ArtifactManager } from "../manager";
import type { FallbackClearer } from "../types";
import { FakeDownloadStateStore, FakeFileSystem, FakeTransport, NodeCryptoHasher, sha256Hex } from "./testDoubles";

const ROOT = "/artifacts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// BUG-199: inline fake (not testDoubles.ts — this suite is the only
// consumer). `sequence`, when shared with a caller-side spy on
// installer.install, lets a test assert clearFallback ran strictly after
// install finished, not just that both happened.
class FakeFallbackClearer implements FallbackClearer {
  readonly calls: string[] = [];

  constructor(
    private readonly opts: { sequence?: string[]; rejectWith?: Error } = {},
  ) {}

  async clearFallback(): Promise<void> {
    this.calls.push("clearFallback");
    this.opts.sequence?.push("clearFallback");
    if (this.opts.rejectWith) throw this.opts.rejectWith;
  }
}

describe("ArtifactManager.downloadAndInstallFullPack", () => {
  it("downloads every file, verifies checksums, and installs the pack as one atomic version", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    const installer = new AtomicInstaller(fs);

    const weights = bytes("model-weights-bytes");
    const config = bytes("model-config-json");

    // A single shared transport, keyed by URL, so each of the two files
    // downloads its own distinct content.
    const contentByUrl = new Map([
      ["https://artifacts.example/model-pack/1.0.0/weights.bin", weights],
      ["https://artifacts.example/model-pack/1.0.0/config.json", config],
    ]);
    const transports = new Map(
      [...contentByUrl.entries()].map(([url, content]) => [url, new FakeTransport(content, { chunkSize: 6 })]),
    );
    const downloader = new ResumableDownloader(
      fs,
      { requestRange: (url, start, signal) => transports.get(url)!.requestRange(url, start, signal) },
      hasher,
      stateStore,
    );

    const manager = new ArtifactManager(ROOT, downloader, installer, hasher);

    const progressCalls: { fileName: string; bytesDownloaded: number }[] = [];
    const result = await manager.downloadAndInstallFullPack({
      artifactKey: "model-pack/1.0.0",
      artifactName: "model-pack",
      version: "1.0.0",
      files: [
        { name: "weights.bin", url: "https://artifacts.example/model-pack/1.0.0/weights.bin", sha256: sha256Hex(weights) },
        { name: "config.json", url: "https://artifacts.example/model-pack/1.0.0/config.json", sha256: sha256Hex(config) },
      ],
      onProgress: (fileName, bytesDownloaded) => progressCalls.push({ fileName, bytesDownloaded }),
    });

    expect(result.version).toBe("1.0.0");
    expect(await manager.getCurrentVersion("model-pack")).toBe("1.0.0");
    expect(Buffer.from(await fs.readFile(`${result.installDir}/weights.bin`)).toString()).toBe(
      Buffer.from(weights).toString(),
    );
    expect(Buffer.from(await fs.readFile(`${result.installDir}/config.json`)).toString()).toBe(
      Buffer.from(config).toString(),
    );
    expect(progressCalls.some((c) => c.fileName === "weights.bin")).toBe(true);
    expect(progressCalls.some((c) => c.fileName === "config.json")).toBe(true);
  });

  it("never installs and leaves the prior version current when one file in the pack fails checksum verification", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    const installer = new AtomicInstaller(fs);

    // Install v1.0.0 first so we can prove it survives untouched.
    const priorContent = bytes("prior-weights");
    await fs.mkdir(`${ROOT}/model-pack/staging/1.0.0`, { recursive: true });
    await fs.writeFile(`${ROOT}/model-pack/staging/1.0.0/weights.bin`, priorContent);
    await installer.install(
      ROOT,
      "model-pack",
      "1.0.0",
      `${ROOT}/model-pack/staging/1.0.0`,
      [{ name: "weights.bin", sha256: sha256Hex(priorContent) }],
      hasher,
    );

    const goodConfig = bytes("config-v2");
    const badWeights = bytes("weights-v2-actual-bytes-served");
    const transports = new Map([
      ["https://artifacts.example/model-pack/2.0.0/weights.bin", new FakeTransport(badWeights, { chunkSize: 6 })],
      ["https://artifacts.example/model-pack/2.0.0/config.json", new FakeTransport(goodConfig, { chunkSize: 6 })],
    ]);
    const downloader = new ResumableDownloader(
      fs,
      { requestRange: (url, start, signal) => transports.get(url)!.requestRange(url, start, signal) },
      hasher,
      stateStore,
    );
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher);

    await expect(
      manager.downloadAndInstallFullPack({
        artifactKey: "model-pack/2.0.0",
        artifactName: "model-pack",
        version: "2.0.0",
        files: [
          {
            name: "weights.bin",
            url: "https://artifacts.example/model-pack/2.0.0/weights.bin",
            sha256: "0".repeat(64), // deliberately wrong — doesn't match badWeights' real hash
          },
          {
            name: "config.json",
            url: "https://artifacts.example/model-pack/2.0.0/config.json",
            sha256: sha256Hex(goodConfig),
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await manager.getCurrentVersion("model-pack")).toBe("1.0.0");
    expect(await fs.exists(installer.versionDir(ROOT, "model-pack", "2.0.0"))).toBe(false);
  });
});

describe("ArtifactManager fallback clearing (BUG-199)", () => {
  function buildHarness() {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const stateStore = new FakeDownloadStateStore();
    const installer = new AtomicInstaller(fs);
    const weights = bytes("model-weights-bytes-v2");
    const config = bytes("model-config-json-v2");
    const transports = new Map([
      ["https://artifacts.example/model-pack/2.0.0/weights.bin", new FakeTransport(weights, { chunkSize: 6 })],
      ["https://artifacts.example/model-pack/2.0.0/config.json", new FakeTransport(config, { chunkSize: 6 })],
    ]);
    const downloader = new ResumableDownloader(
      fs,
      { requestRange: (url, start, signal) => transports.get(url)!.requestRange(url, start, signal) },
      hasher,
      stateStore,
    );
    const request = {
      artifactKey: "model-pack/2.0.0",
      artifactName: "model-pack",
      version: "2.0.0",
      files: [
        {
          name: "weights.bin",
          url: "https://artifacts.example/model-pack/2.0.0/weights.bin",
          sha256: sha256Hex(weights),
        },
        {
          name: "config.json",
          url: "https://artifacts.example/model-pack/2.0.0/config.json",
          sha256: sha256Hex(config),
        },
      ],
    };
    return { fs, hasher, installer, downloader, request };
  }

  it("calls clearFallback exactly once, strictly after install completes, on a fresh 1.7B install", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const sequence: string[] = [];
    const originalInstall = installer.install.bind(installer);
    jest.spyOn(installer, "install").mockImplementation(async (...args: Parameters<typeof originalInstall>) => {
      const result = await originalInstall(...args);
      sequence.push("install-complete");
      return result;
    });
    const clearer = new FakeFallbackClearer({ sequence });

    const manager = new ArtifactManager(ROOT, downloader, installer, hasher, clearer);
    await manager.downloadAndInstallFullPack({ ...request, tier: "1.7B" });

    expect(clearer.calls).toEqual(["clearFallback"]);
    expect(sequence).toEqual(["install-complete", "clearFallback"]);
  });

  it("does not call clearFallback for a 0.6B install", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const clearer = new FakeFallbackClearer();
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher, clearer);

    await manager.downloadAndInstallFullPack({ ...request, tier: "0.6B" });

    expect(clearer.calls).toEqual([]);
  });

  it("does not call clearFallback when the request omits tier", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const clearer = new FakeFallbackClearer();
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher, clearer);

    await manager.downloadAndInstallFullPack(request);

    expect(clearer.calls).toEqual([]);
  });

  it("installs a 1.7B pack successfully when no fallback clearer was provided", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher);

    const result = await manager.downloadAndInstallFullPack({ ...request, tier: "1.7B" });

    expect(result.version).toBe("2.0.0");
    expect(await manager.getCurrentVersion("model-pack")).toBe("2.0.0");
  });

  it("does not call clearFallback when a 1.7B install fails checksum verification", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const clearer = new FakeFallbackClearer();
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher, clearer);

    const badRequest = {
      ...request,
      tier: "1.7B" as const,
      files: [{ ...request.files[0], sha256: "0".repeat(64) }, request.files[1]],
    };

    await expect(manager.downloadAndInstallFullPack(badRequest)).rejects.toThrow();
    expect(clearer.calls).toEqual([]);
  });

  it("propagates a clearFallback rejection, after the install has already completed", async () => {
    const { installer, downloader, hasher, request } = buildHarness();
    const rejectWith = new Error("fallback store unavailable");
    const clearer = new FakeFallbackClearer({ rejectWith });
    const manager = new ArtifactManager(ROOT, downloader, installer, hasher, clearer);

    await expect(manager.downloadAndInstallFullPack({ ...request, tier: "1.7B" })).rejects.toThrow(
      "fallback store unavailable",
    );
    expect(await manager.getCurrentVersion("model-pack")).toBe("2.0.0");
  });
});
