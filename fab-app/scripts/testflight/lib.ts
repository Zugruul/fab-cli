// #144 APP-036 — TestFlight release pipeline (SPEC-APP.md §9.10).
//
// Pure helper logic for fab-app/scripts/testflight-release.sh, invoked at
// runtime via cli.ts (`node_modules/.bin/tsx scripts/testflight/cli.ts ...`
// from the bash script). Kept dependency-free (Node builtins only) and
// side-effect-free (fs/network access is injected or lives in cli.ts) so it
// can be exercised hermetically by jest — no xcodebuild, no real
// credentials, no network in this file or its tests.

import { createSign, KeyObject } from 'node:crypto';

const REQUIRED_ENV_VARS = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH'] as const;
type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
  errors: string[];
}

export interface EnvCheckOptions {
  fileExists?: (path: string) => boolean;
}

/**
 * Validates the three env vars the TestFlight release script requires
 * (App Store Connect API key id/issuer id, and the path to the .p8 private
 * key), plus that the key path actually exists on disk. A missing var and
 * an existing-but-unreadable key path are reported separately so the bash
 * script can print a precise, actionable message.
 */
export function checkTestFlightEnv(
  env: Partial<Record<RequiredEnvVar, string | undefined>>,
  options: EnvCheckOptions = {},
): EnvCheckResult {
  const fileExists = options.fileExists ?? (() => false);
  const missing: string[] = [];
  const errors: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (!missing.includes('ASC_KEY_PATH')) {
    const keyPath = env.ASC_KEY_PATH as string;
    if (!fileExists(keyPath)) {
      errors.push(`ASC_KEY_PATH file not found: ${keyPath}`);
    }
  }

  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

export interface ExportOptionsConfig {
  method?: string;
  destination?: string;
  teamId?: string;
  manageAppVersionAndBuildNumber?: boolean;
}

/**
 * Builds the exportOptions.plist xcodebuild -exportArchive consumes.
 * Defaults target the unified Xcode 15+ export/upload flow that pushes
 * straight to App Store Connect (destination "upload") using the current
 * (non-deprecated) "app-store-connect" method — see `xcodebuild -help`'s
 * "Available keys for -exportOptionsPlist" section (verified against the
 * locally installed Xcode 26.5 toolchain for #144).
 */
export function buildExportOptionsPlist(config: ExportOptionsConfig = {}): string {
  const method = config.method ?? 'app-store-connect';
  const destination = config.destination ?? 'upload';
  const manageAppVersionAndBuildNumber = config.manageAppVersionAndBuildNumber ?? true;

  const entries: string[] = [];
  entries.push('\t<key>method</key>', `\t<string>${method}</string>`);
  entries.push('\t<key>destination</key>', `\t<string>${destination}</string>`);
  entries.push(
    '\t<key>manageAppVersionAndBuildNumber</key>',
    manageAppVersionAndBuildNumber ? '\t<true/>' : '\t<false/>',
  );
  if (config.teamId) {
    entries.push('\t<key>teamID</key>', `\t<string>${config.teamId}</string>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

/**
 * Redacts secret values from log text before it's written to a log file or
 * the console: every literal occurrence of a given secret (e.g. a key path
 * or an already-minted bearer token) plus, as a defensive fallback, any
 * JWT-shaped token even if it was never passed in explicitly.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined | null> = []): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    result = result.split(secret).join('***REDACTED***');
  }
  return result.replace(JWT_PATTERN, '***REDACTED-JWT***');
}

export interface BuildBetaDetailAttributes {
  internalBuildState?: string | null;
  externalBuildState?: string | null;
}

export interface BuildVisibility {
  visible: boolean;
  line: string;
}

/**
 * #257 — a build can reach processingState "VALID" (Apple's binary
 * validation passed) while its buildBetaDetail.internalBuildState is stuck
 * at e.g. "MISSING_EXPORT_COMPLIANCE" — hidden from every tester, with no
 * "missing compliance" row anywhere in App Store Connect's UI. From the
 * verify-build output alone, "VALID" reads as success even though the build
 * is invisible. This is the single source of truth for whether a build is
 * *actually* visible to testers: visible only when processingState is VALID,
 * the build isn't expired, and internalBuildState is exactly
 * "IN_BETA_TESTING" — every other combination (including a failed/missing
 * buildBetaDetail fetch) is reported as a problem, never silently as ok, so
 * this exact confusion can't happen again.
 */
export function describeBuildVisibility(
  build: { processingState: string; expired?: boolean },
  betaDetail: BuildBetaDetailAttributes | null,
): BuildVisibility {
  const internal = betaDetail?.internalBuildState ?? 'UNKNOWN (buildBetaDetail unavailable)';
  const external = betaDetail?.externalBuildState ?? 'n/a';
  const visible =
    build.processingState === 'VALID' && !build.expired && betaDetail?.internalBuildState === 'IN_BETA_TESTING';

  const line = visible
    ? `  beta visibility: ok — internal=${internal} external=${external}`
    : `  beta visibility: PROBLEM — internal=${internal} external=${external} — build is not visible to testers`;

  return { visible, line };
}

const ASC_MAX_TOKEN_LIFETIME_SECONDS = 1200; // App Store Connect API's hard cap (20 minutes)

export interface AscJwtOptions {
  keyId: string;
  issuerId: string;
  privateKeyPem: string | KeyObject;
  now?: () => number;
  expiresInSeconds?: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Signs an App Store Connect API bearer token (ES256 JWT) from the given
 * .p8 private key, per Apple's App Store Connect API authentication
 * contract: header {alg: ES256, kid, typ: JWT}, payload {iss, iat, exp,
 * aud: "appstoreconnect-v1"}, signature over "<header>.<payload>" using the
 * P-256 key with the raw (IEEE P1363) signature encoding JWTs require
 * (Node's ECDSA default is DER, so this must opt into "ieee-p1363").
 */
export function signAppStoreConnectJwt(options: AscJwtOptions): string {
  const expiresInSeconds = options.expiresInSeconds ?? ASC_MAX_TOKEN_LIFETIME_SECONDS;
  if (expiresInSeconds > ASC_MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error(
      `expiresInSeconds (${expiresInSeconds}) exceeds App Store Connect's ${ASC_MAX_TOKEN_LIFETIME_SECONDS}s (20 minute) maximum token lifetime`,
    );
  }

  const now = options.now ?? Date.now;
  const iat = Math.floor(now() / 1000);
  const exp = iat + expiresInSeconds;

  const header = { alg: 'ES256', kid: options.keyId, typ: 'JWT' };
  const payload = { iss: options.issuerId, iat, exp, aud: 'appstoreconnect-v1' };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = createSign('sha256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: options.privateKeyPem as never, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64url(signature)}`;
}
