import { AtomicInstaller } from "../installer";
import { ChecksumMismatchError } from "../errors";
import { FakeFileSystem, NodeCryptoHasher, sha256Hex } from "./testDoubles";

const ROOT = "/artifacts";
const ARTIFACT = "knowledge-pack";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function stageFile(fs: FakeFileSystem, stagedDir: string, name: string, content: Uint8Array) {
  await fs.mkdir(stagedDir, { recursive: true });
  await fs.writeFile(`${stagedDir}/${name}`, content);
}

describe("AtomicInstaller", () => {
  it("installs a fresh version and flips the current pointer", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);

    const stagedDir = `${ROOT}/${ARTIFACT}/staging/1.0.0`;
    const content = bytes("chunks-v1");
    await stageFile(fs, stagedDir, "chunks.sqlite", content);

    const result = await installer.install(
      ROOT,
      ARTIFACT,
      "1.0.0",
      stagedDir,
      [{ name: "chunks.sqlite", sha256: sha256Hex(content) }],
      hasher,
    );

    expect(result.version).toBe("1.0.0");
    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.0.0");
    const installed = await fs.readFile(`${installer.versionDir(ROOT, ARTIFACT, "1.0.0")}/chunks.sqlite`);
    expect(Buffer.from(installed).toString()).toBe("chunks-v1");
  });

  it("refuses to install when a staged file's checksum does not match the manifest, and leaves any prior version untouched", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);

    // Install a known-good v1.0.0 first.
    const v1Dir = `${ROOT}/${ARTIFACT}/staging/1.0.0`;
    const v1Content = bytes("chunks-v1");
    await stageFile(fs, v1Dir, "chunks.sqlite", v1Content);
    await installer.install(ROOT, ARTIFACT, "1.0.0", v1Dir, [{ name: "chunks.sqlite", sha256: sha256Hex(v1Content) }], hasher);

    // Attempt v1.1.0 with a manifest checksum that doesn't match the staged bytes.
    const v2Dir = `${ROOT}/${ARTIFACT}/staging/1.1.0`;
    const v2Content = bytes("chunks-v2-but-corrupted-in-transit");
    await stageFile(fs, v2Dir, "chunks.sqlite", v2Content);

    await expect(
      installer.install(ROOT, ARTIFACT, "1.1.0", v2Dir, [{ name: "chunks.sqlite", sha256: "f".repeat(64) }], hasher),
    ).rejects.toThrow(ChecksumMismatchError);

    // v1.0.0 must still be current and its files untouched.
    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.0.0");
    const stillV1 = await fs.readFile(`${installer.versionDir(ROOT, ARTIFACT, "1.0.0")}/chunks.sqlite`);
    expect(Buffer.from(stillV1).toString()).toBe("chunks-v1");

    // The bad version must never have been moved into the versioned layout.
    expect(await fs.exists(installer.versionDir(ROOT, ARTIFACT, "1.1.0"))).toBe(false);
  });

  it("leaves the prior version installed and current when the final pointer-flip rename fails mid-swap", async () => {
    const fs = new FakeFileSystem();
    const hasher = new NodeCryptoHasher(fs);
    const installer = new AtomicInstaller(fs);

    const v1Dir = `${ROOT}/${ARTIFACT}/staging/1.0.0`;
    const v1Content = bytes("chunks-v1");
    await stageFile(fs, v1Dir, "chunks.sqlite", v1Content);
    await installer.install(ROOT, ARTIFACT, "1.0.0", v1Dir, [{ name: "chunks.sqlite", sha256: sha256Hex(v1Content) }], hasher);

    const v2Dir = `${ROOT}/${ARTIFACT}/staging/1.1.0`;
    const v2Content = bytes("chunks-v2");
    await stageFile(fs, v2Dir, "chunks.sqlite", v2Content);

    // Simulate a crash exactly on the pointer-flip rename (the very last
    // step of install()) — everything up to and including moving the
    // staged dir into its versioned slot has already succeeded on disk.
    const realRename = fs.rename.bind(fs);
    const pointerPath = `${ROOT}/${ARTIFACT}/current.json`;
    fs.rename = jest.fn(async (from: string, to: string) => {
      if (to === pointerPath) {
        throw new Error("simulated crash during pointer flip");
      }
      return realRename(from, to);
    });

    await expect(
      installer.install(ROOT, ARTIFACT, "1.1.0", v2Dir, [{ name: "chunks.sqlite", sha256: sha256Hex(v2Content) }], hasher),
    ).rejects.toThrow("simulated crash during pointer flip");

    // The pointer must still name v1.0.0 — the app keeps running the prior
    // version, and its files are fully intact and readable.
    expect(await installer.getCurrentVersion(ROOT, ARTIFACT)).toBe("1.0.0");
    const stillV1 = await fs.readFile(`${installer.versionDir(ROOT, ARTIFACT, "1.0.0")}/chunks.sqlite`);
    expect(Buffer.from(stillV1).toString()).toBe("chunks-v1");
  });
});
