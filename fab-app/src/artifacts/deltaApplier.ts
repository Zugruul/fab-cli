// §9.5: "applying index deltas — including tombstone deletions — without
// reinstall" — "apply to a copy, swap on success."
//
// Row/entry-level tombstone application is index-format-specific (e.g.
// `DELETE FROM chunks WHERE id IN (...)` against the on-device sqlite-vec
// index) and out of scope here — that lives with the retrieval engine
// (§9.7, a separate task). This module owns the orchestration: copy the
// currently-installed version, layer the delta's added/changed files on
// top, hand the copy to an injected IndexTombstoneApplier, then reuse
// AtomicInstaller's verify+swap so the result is installed exactly as
// atomically as a full pack. The original version directory is never
// mutated — only ever read from, while building an independent copy — so a
// failure at any point before the final swap leaves it untouched.

import { DeltaBaseMismatchError } from "./errors";
import type { AtomicInstaller } from "./installer";
import type { ExpectedFile, FileSystem, Hasher, InstallResult, Tombstones } from "./types";

export interface IndexTombstoneApplier {
  applyTombstones(stagingDir: string, tombstones: Tombstones): Promise<void>;
}

export interface DeltaApplyPlan {
  artifactName: string;
  fromVersion: string;
  toVersion: string;
  /** Already-downloaded, already-verified replacement/new file contents,
   * keyed by file name relative to the pack's install directory. */
  changedFiles: Map<string, Uint8Array>;
  tombstones: Tombstones;
}

export class DeltaApplier {
  constructor(
    private readonly fs: FileSystem,
    private readonly installer: AtomicInstaller,
    private readonly tombstoneApplier: IndexTombstoneApplier,
  ) {}

  async applyDelta(
    root: string,
    plan: DeltaApplyPlan,
    expectedFiles: ExpectedFile[],
    hasher: Hasher,
  ): Promise<InstallResult> {
    const installedVersion = await this.installer.getCurrentVersion(root, plan.artifactName);
    if (installedVersion !== plan.fromVersion) {
      throw new DeltaBaseMismatchError(plan.artifactName, plan.fromVersion, installedVersion);
    }

    const currentDir = this.installer.versionDir(root, plan.artifactName, installedVersion);
    const stagingDir = `${this.installer.artifactRootDir(root, plan.artifactName)}/staging/${plan.toVersion}`;

    await this.copyDir(currentDir, stagingDir);

    for (const [name, bytes] of plan.changedFiles) {
      await this.fs.writeFile(`${stagingDir}/${name}`, bytes);
    }

    await this.tombstoneApplier.applyTombstones(stagingDir, plan.tombstones);

    return this.installer.install(root, plan.artifactName, plan.toVersion, stagingDir, expectedFiles, hasher);
  }

  private async copyDir(fromDir: string, toDir: string): Promise<void> {
    await this.fs.mkdir(toDir, { recursive: true });
    const entries = await this.fs.readDir(fromDir);
    for (const name of entries) {
      await this.fs.copyFile(`${fromDir}/${name}`, `${toDir}/${name}`);
    }
  }
}
