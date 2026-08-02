import { AtomicInstaller } from "../installer";
import { DeltaApplier, type IndexTombstoneApplier } from "../deltaApplier";
import { DeltaBaseMismatchError } from "../errors";
import type { FileSystem, Tombstones } from "../types";
import { FakeFileSystem, NodeCryptoHasher, sha256Hex } from "./testDoubles";

const ROOT = "/artifacts";
const ARTIFACT = "knowledge-pack";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Mirrors how a real index (a per-chunk-file layout, or a sqlite-vec DB
 * exposing a matching delete API) would honor tombstones: files named after
 * the tombstoned id are removed from the staged copy only. */
class FileNamedByIdTombstoneApplier implements IndexTombstoneApplier {
  constructor(private readonly fs: FileSystem) {}

  async applyTombstones(stagingDir: string, tombstones: Tombstones): Promise<void> {
    for (const chunkId of tombstones.chunkIds) {
      const path = `${stagingDir}/chunk-${chunkId}.dat`;
      if (await this.fs.exists(path)) await this.fs.deleteFile(path);
    }
    for (const printingId of tombstones.printingIds) {
      const path = `${stagingDir}/printing-${printingId}.dat`;
      if (await this.fs.exists(path)) await this.fs.deleteFile(path);
    }
  }
}

async function installBaseVersion(fs: FakeFileSystem, hasher: NodeCryptoHasher, installer: AtomicInstaller) {
  const stagedDir = `${ROOT}/${ARTIFACT}/staging/1.0.0`;
  const chunkA = bytes("chunk-a-content");
  const chunkB = bytes("chunk-b-content");
  const index = bytes("index-v1");
  await fs.mkdir(stagedDir, { recursive: true });
  await fs.writeFile(`${stagedDir}/chunk-a.dat`, chunkA);
  await fs.writeFile(`${stagedDir}/chunk-b.dat`, chunkB);
  await fs.writeFile(`${stagedDir}/index.json`, index);
  await installer.install(
    ROOT,
    ARTIFACT,
    "1.0.0",
    stagedDir,
    [
      { name: "chunk-a.dat", sha256: sha256Hex(chunkA) },
      { name: "chunk-b.dat", sha256: sha256Hex(chunkB) },
      { name: "index.json", sha256: sha256Hex(index) },
    ],
    hasher,
  );
  return { chunkA, chunkB, index };
}

describe("DeltaApplier", () => {
  it("applies added/changed files and tombstone deletions to a COPY, then atomically swaps — leaving the prior version's files untouched", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);
    const tombstoneApplier = new FileNamedByIdTombstoneApplier(fs);
    const deltaApplier = new DeltaApplier(fs, installer, tombstoneApplier);

    const { chunkA } = await installBaseVersion(fs, hasher, installer);
    const newIndex = bytes("index-v2");

    const result = await deltaApplier.applyDelta(
      ROOT,
      {
        artifactName: ARTIFACT,
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
        changedFiles: new Map([["index.json", newIndex]]),
        tombstones: { chunkIds: ["b"], printingIds: [] },
      },
      [
        { name: "chunk-a.dat", sha256: sha256Hex(chunkA) },
        { name: "index.json", sha256: sha256Hex(newIndex) },
      ],
      hasher,
    );

    expect(result.version).toBe("1.1.0");
    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.1.0");

    const newVersionDir = installer.versionDir(ROOT, ARTIFACT, "1.1.0");
    expect(Buffer.from(await fs.readFile(`${newVersionDir}/chunk-a.dat`)).toString()).toBe("chunk-a-content");
    expect(Buffer.from(await fs.readFile(`${newVersionDir}/index.json`)).toString()).toBe("index-v2");
    expect(await fs.exists(`${newVersionDir}/chunk-b.dat`)).toBe(false);

    // The original 1.0.0 directory was never mutated — tombstoning
    // happened on a copy, not in place.
    const oldVersionDir = installer.versionDir(ROOT, ARTIFACT, "1.0.0");
    expect(await fs.exists(`${oldVersionDir}/chunk-b.dat`)).toBe(true);
    expect(Buffer.from(await fs.readFile(`${oldVersionDir}/chunk-b.dat`)).toString()).toBe("chunk-b-content");
    expect(Buffer.from(await fs.readFile(`${oldVersionDir}/index.json`)).toString()).toBe("index-v1");
  });

  it("refuses to apply a delta whose fromVersion does not match what's actually installed", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);
    const tombstoneApplier = new FileNamedByIdTombstoneApplier(fs);
    const deltaApplier = new DeltaApplier(fs, installer, tombstoneApplier);

    await installBaseVersion(fs, hasher, installer);

    await expect(
      deltaApplier.applyDelta(
        ROOT,
        {
          artifactName: ARTIFACT,
          fromVersion: "1.2.0", // installed version is actually 1.0.0
          toVersion: "1.3.0",
          changedFiles: new Map(),
          tombstones: { chunkIds: [], printingIds: [] },
        },
        [],
        hasher,
      ),
    ).rejects.toThrow(DeltaBaseMismatchError);

    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.0.0");
  });

  it("leaves the prior version installed and current when tombstone application fails mid-apply", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);
    const failingTombstoneApplier: IndexTombstoneApplier = {
      applyTombstones: jest.fn(async () => {
        throw new Error("simulated failure applying tombstones");
      }),
    };
    const deltaApplier = new DeltaApplier(fs, installer, failingTombstoneApplier);

    const { chunkA, chunkB, index } = await installBaseVersion(fs, hasher, installer);

    await expect(
      deltaApplier.applyDelta(
        ROOT,
        {
          artifactName: ARTIFACT,
          fromVersion: "1.0.0",
          toVersion: "1.1.0",
          changedFiles: new Map(),
          tombstones: { chunkIds: ["b"], printingIds: [] },
        },
        [
          { name: "chunk-a.dat", sha256: sha256Hex(chunkA) },
          { name: "chunk-b.dat", sha256: sha256Hex(chunkB) },
          { name: "index.json", sha256: sha256Hex(index) },
        ],
        hasher,
      ),
    ).rejects.toThrow("simulated failure applying tombstones");

    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.0.0");
    const oldVersionDir = installer.versionDir(ROOT, ARTIFACT, "1.0.0");
    expect(Buffer.from(await fs.readFile(`${oldVersionDir}/chunk-b.dat`)).toString()).toBe("chunk-b-content");
    // The half-applied delta must never have become the current version.
    expect(await fs.exists(installer.versionDir(ROOT, ARTIFACT, "1.1.0"))).toBe(false);
  });
});
