// §9.2/§9.5: atomic install/swap — staged dir → verify checksums → atomic
// rename. On-disk layout per (root, artifactName):
//
//   <root>/<artifactName>/versions/<version>/...files
//   <root>/<artifactName>/current.json            { "version": "<version>" }
//
// The prior version's directory is never touched by install() — a new
// version lands in its own directory, and only the very last step (a
// rename of a freshly-written temp file onto current.json) flips which
// version is active. Any failure before that rename leaves the previous
// version's directory and pointer exactly as they were.

import { ChecksumMismatchError } from "./errors";
import type { ExpectedFile, FileSystem, Hasher, InstallResult } from "./types";

export class AtomicInstaller {
  constructor(private readonly fs: FileSystem) {}

  artifactRootDir(root: string, artifactName: string): string {
    return `${root}/${artifactName}`;
  }

  versionDir(root: string, artifactName: string, version: string): string {
    return `${this.artifactRootDir(root, artifactName)}/versions/${version}`;
  }

  private pointerPath(root: string, artifactName: string): string {
    return `${this.artifactRootDir(root, artifactName)}/current.json`;
  }

  async getCurrentVersion(root: string, artifactName: string): Promise<string | null> {
    const pointerPath = this.pointerPath(root, artifactName);
    if (!(await this.fs.exists(pointerPath))) {
      return null;
    }
    const bytes = await this.fs.readFile(pointerPath);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  }

  /**
   * Verifies every expected file's checksum inside `stagedDir`, then
   * atomically installs it as `version` and flips the artifact's "current"
   * pointer to it.
   *
   * Ordering matters for the atomicity guarantee: checksum verification and
   * the staged→versioned rename both happen strictly before the prior
   * version's pointer is touched, so any failure up to and including the
   * version-dir rename leaves the previously-installed version fully
   * intact and still active.
   */
  async install(
    root: string,
    artifactName: string,
    version: string,
    stagedDir: string,
    expectedFiles: ExpectedFile[],
    hasher: Hasher,
  ): Promise<InstallResult> {
    for (const file of expectedFiles) {
      const filePath = `${stagedDir}/${file.name}`;
      const actual = await hasher.sha256File(filePath);
      if (actual.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new ChecksumMismatchError(`${artifactName}/${version}/${file.name}`, file.sha256, actual);
      }
    }

    const versionsDir = `${this.artifactRootDir(root, artifactName)}/versions`;
    await this.fs.mkdir(versionsDir, { recursive: true });

    const targetDir = this.versionDir(root, artifactName, version);
    await this.fs.rename(stagedDir, targetDir);

    const pointerPath = this.pointerPath(root, artifactName);
    const pointerTmpPath = `${pointerPath}.tmp`;
    await this.fs.writeFile(pointerTmpPath, new TextEncoder().encode(JSON.stringify({ version })));
    await this.fs.rename(pointerTmpPath, pointerPath);

    return { version, installDir: targetDir };
  }
}
