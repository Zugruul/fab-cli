/**
 * Release-gate enforcement policy (SPEC-APP.md §8.5, §13 invariant 8;
 * APP-023 #135). gate.ts's checkGate() already PRODUCES the raw (a)/(b)/(c)
 * breach signals from an EvalRunSummary — this module never reimplements
 * that threshold math, it only consumes it. What this module adds is the
 * one policy layer §8.5's second clause requires and gate.ts's own
 * top-of-file comment explicitly defers to APP-023: "for major versions a
 * human-audited sample review is additionally required before release."
 */
import fs from "node:fs";
import { checkGate, type GateBreach, type GateCheckResult } from "./gate.js";
import type { PreviousSuiteScore } from "./regression.js";
import type { EvalGateConfig, EvalRunSummary, EvalSuiteId } from "./types.js";

export class InvalidVersionError extends Error {}

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * RUNTIME GUARD on an invariant-bearing field: a version string decides
 * whether the human-audit gate applies at all, so a malformed version must
 * throw loudly rather than silently parse to something that skips the
 * audit requirement. Strict "MAJOR.MINOR.PATCH" only — no "v" prefix, no
 * pre-release/build-metadata suffixes (none of that vocabulary exists
 * anywhere else in this repo's manifests yet; widen this only if a real
 * versioning scheme is adopted, never guess one here).
 */
export function parseSemver(version: string): Semver {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) {
    throw new InvalidVersionError(`invalid version "${version}": expected strict semver "MAJOR.MINOR.PATCH" (e.g. "2.0.0")`);
  }
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/**
 * A release is a MAJOR bump when its major component is strictly greater
 * than the previous released version's. With no previous version at all
 * (first-ever release) the candidate is ALSO treated as major — there is
 * no release history to have regressed against, so the human-audit step is
 * the only quality gate beyond the automated suites a first release gets;
 * treating "no previous version" as "not major" would silently reopen
 * exactly the gap §8.5's human-audit clause exists to close.
 */
export function isMajorVersionBump(candidateVersion: string, previousVersion: string | null): boolean {
  const candidate = parseSemver(candidateVersion);
  if (previousVersion === null) return true;
  const previous = parseSemver(previousVersion);
  return candidate.major > previous.major;
}

export type AuditVerdict = "APPROVE" | "BLOCK";

/**
 * `extractAuditVerdict`'s result, discriminated so the gate can give a
 * distinct "ambiguous audit record" reason rather than lumping it in with
 * a plain "no completed sign-off".
 */
export type AuditVerdictExtraction =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly verdict: AuditVerdict }
  | { readonly kind: "ambiguous"; readonly verdicts: readonly AuditVerdict[] };

const VERDICT_RE_G = /Verdict:\s*(APPROVE|BLOCK)\b/gi;

/**
 * Reads the human auditor's sign-off verdict out of a completed audit
 * record (see release-audits/TEMPLATE.md's "## Sign-off" section).
 *
 * Collects EVERY `Verdict:` match in the document rather than taking the
 * first one — a previous version took only the first match, so a stale
 * `Verdict: APPROVE` left in place above a corrected `Verdict: BLOCK`
 * silently resolved APPROVE (the unsafe direction: a corrected block
 * getting overridden by a stale approval). More than one DISTINCT verdict
 * anywhere in the document is refused as "ambiguous" rather than guessed —
 * this also covers a stray `Verdict:`-shaped mention outside the Sign-off
 * section, since any spurious match either agrees with the real one
 * (harmless) or disagrees (correctly refused, never silently approved).
 * Identical duplicate lines (the same verdict repeated, e.g. quoted twice)
 * carry no conflicting signal and are accepted as a single verdict, not
 * treated as ambiguous.
 *
 * `kind: "none"` covers anything that isn't a completed verdict — no match
 * at all, or the template's own unfilled `Verdict: <APPROVE | BLOCK>`
 * placeholder, which must never be mistaken for a real sign-off.
 */
export function extractAuditVerdict(content: string): AuditVerdictExtraction {
  const matches = Array.from(content.matchAll(VERDICT_RE_G), (m) => m[1].toUpperCase() as AuditVerdict);
  if (matches.length === 0) return { kind: "none" };
  const distinct = [...new Set(matches)];
  if (distinct.length > 1) return { kind: "ambiguous", verdicts: distinct };
  return { kind: "single", verdict: distinct[0] };
}

export interface ReleaseGateBreach {
  clause: GateBreach["clause"] | "8.5-audit";
  suiteId?: EvalSuiteId;
  message: string;
}

export interface ReleaseGateResult {
  passed: boolean;
  breaches: ReleaseGateBreach[];
  isMajorVersion: boolean;
  /** The unmodified underlying signal from gate.ts's checkGate(). */
  gate: GateCheckResult;
}

export interface CheckReleaseGateInput {
  summary: EvalRunSummary;
  config: EvalGateConfig;
  previous?: readonly PreviousSuiteScore[];
  candidateVersion: string;
  previousVersion?: string | null;
  /** Path to a completed audit record — required (and checked) only when
   * the candidate is a major-version bump. */
  auditRecordPath?: string | null;
  /** Injectable so tests never touch a real filesystem for the decision
   * logic itself — defaults to node:fs. */
  readAuditRecord?: (path: string) => string;
}

function defaultReadAuditRecord(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function checkAuditRequirement(auditRecordPath: string | null, readAuditRecord: (path: string) => string): ReleaseGateBreach | null {
  if (!auditRecordPath) {
    return {
      clause: "8.5-audit",
      message:
        "candidate is a MAJOR version bump: §8.5 requires a completed human-audited sample review before release, but no --audit-record path was provided",
    };
  }
  let content: string;
  try {
    content = readAuditRecord(auditRecordPath);
  } catch {
    return {
      clause: "8.5-audit",
      message: `candidate is a MAJOR version bump: audit record not found at "${auditRecordPath}"`,
    };
  }
  const extraction = extractAuditVerdict(content);
  if (extraction.kind === "none") {
    return {
      clause: "8.5-audit",
      message: `candidate is a MAJOR version bump: audit record at "${auditRecordPath}" has no completed sign-off ("Verdict: APPROVE" or "Verdict: BLOCK")`,
    };
  }
  if (extraction.kind === "ambiguous") {
    return {
      clause: "8.5-audit",
      message: `candidate is a MAJOR version bump: audit record at "${auditRecordPath}" is ambiguous — found conflicting sign-off verdicts (${extraction.verdicts.join(", ")}); resolve to a single verdict before release`,
    };
  }
  if (extraction.verdict === "BLOCK") {
    return {
      clause: "8.5-audit",
      message: `human-audited sample review recorded verdict BLOCK for this candidate (see "${auditRecordPath}")`,
    };
  }
  return null;
}

/**
 * The full release-gate decision: gate.ts's (a)/(b)/(c) breaches, PLUS —
 * only for major-version candidates — the human-audit-record requirement.
 * Never reimplements checkGate()'s threshold math; only composes it with
 * the one additional §8.5 policy clause APP-022 deferred.
 */
export function checkReleaseGate(input: CheckReleaseGateInput): ReleaseGateResult {
  const gate = checkGate(input.summary, input.config, input.previous ?? []);
  const breaches: ReleaseGateBreach[] = gate.breaches.map((b) => ({ ...b }));

  const isMajorVersion = isMajorVersionBump(input.candidateVersion, input.previousVersion ?? null);
  if (isMajorVersion) {
    const auditBreach = checkAuditRequirement(input.auditRecordPath ?? null, input.readAuditRecord ?? defaultReadAuditRecord);
    if (auditBreach) breaches.push(auditBreach);
  }

  return { passed: breaches.length === 0, breaches, isMajorVersion, gate };
}
