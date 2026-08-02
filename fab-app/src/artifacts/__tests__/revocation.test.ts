import { RevocationChecker, RevocationHandler } from "../revocation";
import type { ArtifactVersionRef } from "../types";
import { FakeArtifactDisabledStateStore, FakeArtifactHost } from "./testDoubles";

function versionRef(artifact: string, version: string): ArtifactVersionRef {
  return {
    artifact,
    version,
    manifestUrl: `https://artifacts.example/${artifact}/${version}/manifest.json`,
    downloadUrl: `https://artifacts.example/${artifact}/${version}/pack.tar`,
  };
}

describe("RevocationChecker", () => {
  it("returns no action for an installed artifact that is not revoked", async () => {
    const host = new FakeArtifactHost(new Map());
    const checker = new RevocationChecker(host);

    const actions = await checker.check(
      [{ artifactName: "knowledge-pack", version: "1.0.0" }],
      { schemaVersion: "0.1.0", revokedVersions: [] },
    );

    expect(actions).toEqual([]);
  });

  it("schedules the newest non-revoked version when the installed version is revoked", async () => {
    const host = new FakeArtifactHost(
      new Map([
        [
          "knowledge-pack",
          [versionRef("knowledge-pack", "1.0.0"), versionRef("knowledge-pack", "1.1.0"), versionRef("knowledge-pack", "1.2.0")],
        ],
      ]),
    );
    const checker = new RevocationChecker(host);

    const actions = await checker.check(
      [{ artifactName: "knowledge-pack", version: "1.0.0" }],
      {
        schemaVersion: "0.1.0",
        revokedVersions: [{ artifact: "knowledge-pack", version: "1.0.0", reason: "corrupt sqlite-vec index" }],
      },
    );

    expect(actions).toEqual([
      {
        kind: "disable-and-redownload",
        artifactName: "knowledge-pack",
        revokedVersion: "1.0.0",
        reason: "corrupt sqlite-vec index",
        nextVersion: versionRef("knowledge-pack", "1.2.0"),
      },
    ]);
  });

  it("skips a revoked candidate version and picks the newest of the remaining non-revoked ones", async () => {
    const host = new FakeArtifactHost(
      new Map([
        [
          "knowledge-pack",
          [versionRef("knowledge-pack", "1.0.0"), versionRef("knowledge-pack", "1.1.0"), versionRef("knowledge-pack", "1.2.0")],
        ],
      ]),
    );
    const checker = new RevocationChecker(host);

    const actions = await checker.check(
      [{ artifactName: "knowledge-pack", version: "1.0.0" }],
      {
        schemaVersion: "0.1.0",
        revokedVersions: [
          { artifact: "knowledge-pack", version: "1.0.0", reason: "corrupt index" },
          { artifact: "knowledge-pack", version: "1.2.0", reason: "also revoked" },
        ],
      },
    );

    expect(actions[0].kind).toBe("disable-and-redownload");
    expect((actions[0] as { nextVersion: ArtifactVersionRef }).nextVersion).toEqual(
      versionRef("knowledge-pack", "1.1.0"),
    );
  });

  it("reports disable-no-replacement when every available version is revoked", async () => {
    const host = new FakeArtifactHost(new Map([["knowledge-pack", [versionRef("knowledge-pack", "1.0.0")]]]));
    const checker = new RevocationChecker(host);

    const actions = await checker.check(
      [{ artifactName: "knowledge-pack", version: "1.0.0" }],
      {
        schemaVersion: "0.1.0",
        revokedVersions: [{ artifact: "knowledge-pack", version: "1.0.0", reason: "corrupt index" }],
      },
    );

    expect(actions).toEqual([
      {
        kind: "disable-no-replacement",
        artifactName: "knowledge-pack",
        revokedVersion: "1.0.0",
        reason: "corrupt index",
      },
    ]);
  });
});

describe("RevocationHandler", () => {
  it("marks the artifact disabled (user-notified state) and schedules a redownload of the newest non-revoked version", async () => {
    const host = new FakeArtifactHost(
      new Map([["model-pack", [versionRef("model-pack", "1.0.0"), versionRef("model-pack", "1.1.0")]]]),
    );
    const checker = new RevocationChecker(host);
    const disabledStore = new FakeArtifactDisabledStateStore();
    const scheduled: ArtifactVersionRef[] = [];
    const handler = new RevocationHandler(checker, disabledStore, (ref) => scheduled.push(ref));

    const actions = await handler.reconcile(
      [{ artifactName: "model-pack", version: "1.0.0" }],
      {
        schemaVersion: "0.1.0",
        revokedVersions: [{ artifact: "model-pack", version: "1.0.0", reason: "bad quantization" }],
      },
    );

    expect(actions).toHaveLength(1);
    expect(disabledStore.disabled).toEqual([
      { artifactName: "model-pack", version: "1.0.0", reason: "bad quantization" },
    ]);
    expect(scheduled).toEqual([versionRef("model-pack", "1.1.0")]);
  });

  it("marks the artifact disabled but does NOT schedule a redownload when no replacement exists", async () => {
    const host = new FakeArtifactHost(new Map([["model-pack", [versionRef("model-pack", "1.0.0")]]]));
    const checker = new RevocationChecker(host);
    const disabledStore = new FakeArtifactDisabledStateStore();
    const scheduled: ArtifactVersionRef[] = [];
    const handler = new RevocationHandler(checker, disabledStore, (ref) => scheduled.push(ref));

    await handler.reconcile(
      [{ artifactName: "model-pack", version: "1.0.0" }],
      {
        schemaVersion: "0.1.0",
        revokedVersions: [{ artifact: "model-pack", version: "1.0.0", reason: "bad quantization" }],
      },
    );

    expect(disabledStore.disabled).toEqual([
      { artifactName: "model-pack", version: "1.0.0", reason: "bad quantization" },
    ]);
    expect(scheduled).toEqual([]);
  });
});
