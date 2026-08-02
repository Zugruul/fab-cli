// Typed errors for the artifact manager. Every error carries a stable
// `code` discriminant (in addition to `instanceof`) so callers — including
// the §9.9 first-run UI and §9.3 remediation messaging — can branch on
// error identity without string-matching `.message`.

export class ChecksumMismatchError extends Error {
  readonly code = "CHECKSUM_MISMATCH" as const;
  constructor(
    readonly artifactKey: string,
    readonly expectedSha256: string,
    readonly actualSha256: string,
  ) {
    super(
      `checksum mismatch for ${artifactKey}: expected ${expectedSha256}, got ${actualSha256}`,
    );
    this.name = "ChecksumMismatchError";
  }
}

export type CompatibilityReason =
  | "text-embedder-mismatch"
  | "vision-embedder-mismatch"
  | "knowledge-pack-version-out-of-range"
  | "app-below-min-version";

/** §9.3: "SHALL refuse to load mismatched combinations with a user-visible
 * remediation message" — `reason` is the stable code that message is keyed
 * off of; `details` carries the raw values for diagnostics/logging. */
export class ManifestCompatibilityError extends Error {
  readonly code = "MANIFEST_INCOMPATIBLE" as const;
  constructor(
    readonly reason: CompatibilityReason,
    readonly details: Record<string, string>,
  ) {
    super(`manifest incompatible (${reason}): ${JSON.stringify(details)}`);
    this.name = "ManifestCompatibilityError";
  }
}

export class AtomicSwapFailedError extends Error {
  readonly code = "ATOMIC_SWAP_FAILED" as const;
  constructor(
    readonly artifactName: string,
    readonly version: string,
    cause: unknown,
  ) {
    super(`atomic swap failed for ${artifactName}@${version}: ${String(cause)}`);
    this.name = "AtomicSwapFailedError";
  }
}

export class DeltaBaseMismatchError extends Error {
  readonly code = "DELTA_BASE_MISMATCH" as const;
  constructor(
    readonly artifactName: string,
    readonly expectedFromVersion: string,
    readonly installedVersion: string | null,
  ) {
    super(
      `delta pack for ${artifactName} expects fromVersion ${expectedFromVersion} but installed version is ${
        installedVersion ?? "(none)"
      }`,
    );
    this.name = "DeltaBaseMismatchError";
  }
}
