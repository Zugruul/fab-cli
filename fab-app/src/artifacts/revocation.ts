// §9.5: "IF the active manifest's revoked-versions list names a
// currently-installed artifact THEN THE SYSTEM SHALL stop using it, notify
// the user, and download the newest non-revoked version."

import { compareVersions } from "./semver";
import type {
  ArtifactDisabledStateStore,
  ArtifactHost,
  ArtifactVersionRef,
  InstalledArtifactRecord,
  RevocationAction,
  RevocationList,
} from "./types";

/** Computes the actions §9.5 requires, without side effects — RevocationHandler
 * below is what actually applies them (disables + schedules the redownload). */
export class RevocationChecker {
  constructor(private readonly host: ArtifactHost) {}

  async check(
    installed: InstalledArtifactRecord[],
    revocationList: RevocationList,
  ): Promise<RevocationAction[]> {
    const actions: RevocationAction[] = [];

    for (const record of installed) {
      const hit = revocationList.revokedVersions.find(
        (r) => r.artifact === record.artifactName && r.version === record.version,
      );
      if (!hit) continue;

      const revokedVersionsForArtifact = new Set(
        revocationList.revokedVersions
          .filter((r) => r.artifact === record.artifactName)
          .map((r) => r.version),
      );
      const available = await this.host.listAvailableVersions(record.artifactName);
      const newest = pickNewestNonRevoked(available, revokedVersionsForArtifact);

      actions.push(
        newest
          ? {
              kind: "disable-and-redownload",
              artifactName: record.artifactName,
              revokedVersion: record.version,
              reason: hit.reason,
              nextVersion: newest,
            }
          : {
              kind: "disable-no-replacement",
              artifactName: record.artifactName,
              revokedVersion: record.version,
              reason: hit.reason,
            },
      );
    }

    return actions;
  }
}

function pickNewestNonRevoked(
  available: ArtifactVersionRef[],
  revokedVersions: Set<string>,
): ArtifactVersionRef | null {
  let newest: ArtifactVersionRef | null = null;
  for (const candidate of available) {
    if (revokedVersions.has(candidate.version)) continue;
    if (!newest || compareVersions(candidate.version, newest.version) > 0) {
      newest = candidate;
    }
  }
  return newest;
}

/** Applies RevocationChecker's actions: marks the artifact disabled
 * (user-notified state) and, when a non-revoked replacement exists,
 * schedules its redownload via the injected callback — the actual
 * download+install pipeline is the caller's ResumableDownloader/AtomicInstaller,
 * kept out of this module so revocation policy stays independently testable. */
export class RevocationHandler {
  constructor(
    private readonly checker: RevocationChecker,
    private readonly disabledStateStore: ArtifactDisabledStateStore,
    private readonly scheduleRedownload: (nextVersion: ArtifactVersionRef) => void,
  ) {}

  async reconcile(
    installed: InstalledArtifactRecord[],
    revocationList: RevocationList,
  ): Promise<RevocationAction[]> {
    const actions = await this.checker.check(installed, revocationList);

    for (const action of actions) {
      await this.disabledStateStore.markDisabled(action.artifactName, action.revokedVersion, action.reason);
      if (action.kind === "disable-and-redownload") {
        this.scheduleRedownload(action.nextVersion);
      }
    }

    return actions;
  }
}
