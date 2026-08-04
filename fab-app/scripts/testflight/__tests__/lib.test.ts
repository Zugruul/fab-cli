// #144 APP-036 — TestFlight release pipeline (SPEC-APP.md §9.10). These cover
// the three pieces of the release script that are meaningfully unit-testable
// without a real Xcode/App Store Connect round trip: preflight env
// validation, export-options plist generation, and log redaction, plus the
// App Store Connect API JWT signer (ES256, hand-rolled — no xcodebuild
// involved, so it's cheap to de-risk here rather than only at the live run).
// The archive/export/upload steps themselves are exercised by the live
// script run (see docs/ios-distribution.md), never by this gate-run suite —
// no xcodebuild, no network, no real credentials anywhere in this file.

import { generateKeyPairSync, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import {
  checkTestFlightEnv,
  buildExportOptionsPlist,
  redactSecrets,
  signAppStoreConnectJwt,
  describeBuildVisibility,
} from '../lib';

describe('checkTestFlightEnv', () => {
  const fileExists = (existing: string[]) => (path: string) => existing.includes(path);

  it('reports all three required vars missing when env is empty', () => {
    const result = checkTestFlightEnv({}, { fileExists: fileExists([]) });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH']);
    expect(result.errors).toEqual([]);
  });

  it('treats an empty-string value as missing, not present', () => {
    const result = checkTestFlightEnv(
      { ASC_KEY_ID: '', ASC_ISSUER_ID: 'issuer', ASC_KEY_PATH: '/tmp/key.p8' },
      { fileExists: fileExists(['/tmp/key.p8']) },
    );
    expect(result.missing).toEqual(['ASC_KEY_ID']);
  });

  it('flags a key path that does not exist on disk, distinct from a missing var', () => {
    const result = checkTestFlightEnv(
      { ASC_KEY_ID: 'KEYID', ASC_ISSUER_ID: 'issuer', ASC_KEY_PATH: '/tmp/nope.p8' },
      { fileExists: fileExists([]) },
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.errors).toEqual(['ASC_KEY_PATH file not found: /tmp/nope.p8']);
  });

  it('is ok when all three vars are set and the key file exists', () => {
    const result = checkTestFlightEnv(
      { ASC_KEY_ID: 'KEYID', ASC_ISSUER_ID: 'issuer', ASC_KEY_PATH: '/tmp/key.p8' },
      { fileExists: fileExists(['/tmp/key.p8']) },
    );
    expect(result).toEqual({ ok: true, missing: [], errors: [] });
  });

  it('does not check file existence for a key path that is itself missing', () => {
    let called = false;
    const result = checkTestFlightEnv(
      { ASC_KEY_ID: 'KEYID', ASC_ISSUER_ID: 'issuer' },
      { fileExists: () => { called = true; return true; } },
    );
    expect(result.missing).toEqual(['ASC_KEY_PATH']);
    expect(called).toBe(false);
  });
});

describe('buildExportOptionsPlist', () => {
  it('defaults to the App Store Connect upload method/destination with version management on', () => {
    const plist = buildExportOptionsPlist();
    expect(plist).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(plist).toContain('<key>method</key>\n\t<string>app-store-connect</string>');
    expect(plist).toContain('<key>destination</key>\n\t<string>upload</string>');
    expect(plist).toContain('<key>manageAppVersionAndBuildNumber</key>\n\t<true/>');
    expect(plist).not.toContain('<key>teamID</key>');
    expect(plist.trim().endsWith('</plist>')).toBe(true);
  });

  it('includes teamID only when a team id is given', () => {
    const plist = buildExportOptionsPlist({ teamId: 'ABCDE12345' });
    expect(plist).toContain('<key>teamID</key>\n\t<string>ABCDE12345</string>');
  });

  it('honors an explicit false for manageAppVersionAndBuildNumber', () => {
    const plist = buildExportOptionsPlist({ manageAppVersionAndBuildNumber: false });
    expect(plist).toContain('<key>manageAppVersionAndBuildNumber</key>\n\t<false/>');
  });

  it('honors overridden method/destination', () => {
    const plist = buildExportOptionsPlist({ method: 'release-testing', destination: 'export' });
    expect(plist).toContain('<key>method</key>\n\t<string>release-testing</string>');
    expect(plist).toContain('<key>destination</key>\n\t<string>export</string>');
  });

  it('produces well-formed plist XML (balanced dict, no stray keys)', () => {
    const plist = buildExportOptionsPlist({ teamId: 'ABCDE12345' });
    const openDict = (plist.match(/<dict>/g) || []).length;
    const closeDict = (plist.match(/<\/dict>/g) || []).length;
    expect(openDict).toBe(closeDict);
    expect(plist).toContain('<plist version="1.0">');
  });
});

describe('redactSecrets', () => {
  it('replaces every literal occurrence of a given secret', () => {
    const text = 'key path is /Users/me/.appstoreconnect/private/AuthKey_X.p8, used twice: /Users/me/.appstoreconnect/private/AuthKey_X.p8';
    const out = redactSecrets(text, ['/Users/me/.appstoreconnect/private/AuthKey_X.p8']);
    expect(out).not.toContain('/Users/me/.appstoreconnect/private/AuthKey_X.p8');
    expect(out.match(/\*\*\*REDACTED\*\*\*/g)).toHaveLength(2);
  });

  it('redacts multiple distinct secrets independently', () => {
    const out = redactSecrets('issuer=SECRET1 token=SECRET2', ['SECRET1', 'SECRET2']);
    expect(out).toBe('issuer=***REDACTED*** token=***REDACTED***');
  });

  it('ignores undefined/null/empty secrets rather than redacting everything', () => {
    const out = redactSecrets('hello world', [undefined, null, '']);
    expect(out).toBe('hello world');
  });

  it('leaves text with no matching secrets untouched', () => {
    const out = redactSecrets('nothing sensitive here', ['not-present']);
    expect(out).toBe('nothing sensitive here');
  });

  it('auto-redacts a JWT-shaped bearer token even when not passed explicitly', () => {
    const fakeJwt = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJhYmMifQ.MEUCIQDfakeSignaturePart1abc';
    const out = redactSecrets(`Authorization: Bearer ${fakeJwt}`, []);
    expect(out).not.toContain(fakeJwt);
    expect(out).toContain('***REDACTED-JWT***');
  });
});

describe('signAppStoreConnectJwt', () => {
  function makeTestKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey,
    };
  }

  function decodePart(part: string) {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  }

  it('produces a 3-part base64url token with the expected header and payload', () => {
    const { privateKeyPem } = makeTestKeyPair();
    const fixedNow = 1_700_000_000_000;
    const token = signAppStoreConnectJwt({
      keyId: 'TESTKEY',
      issuerId: 'TESTISSUER',
      privateKeyPem,
      now: () => fixedNow,
    });

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const header = decodePart(parts[0]);
    expect(header).toEqual({ alg: 'ES256', kid: 'TESTKEY', typ: 'JWT' });

    const payload = decodePart(parts[1]);
    const iat = Math.floor(fixedNow / 1000);
    expect(payload).toEqual({ iss: 'TESTISSUER', iat, exp: iat + 1200, aud: 'appstoreconnect-v1' });
  });

  it('respects a custom expiresInSeconds', () => {
    const { privateKeyPem } = makeTestKeyPair();
    const fixedNow = 1_700_000_000_000;
    const token = signAppStoreConnectJwt({
      keyId: 'K',
      issuerId: 'I',
      privateKeyPem,
      now: () => fixedNow,
      expiresInSeconds: 300,
    });
    const payload = decodePart(token.split('.')[1]);
    expect(payload.exp - payload.iat).toBe(300);
  });

  it('throws if expiresInSeconds exceeds App Store Connect\'s 20-minute maximum', () => {
    const { privateKeyPem } = makeTestKeyPair();
    expect(() =>
      signAppStoreConnectJwt({ keyId: 'K', issuerId: 'I', privateKeyPem, expiresInSeconds: 1201 }),
    ).toThrow(/1200/);
  });

  it('produces a signature that verifies against the matching public key (ES256 / P-1363)', () => {
    const { privateKeyPem, publicKey } = makeTestKeyPair();
    const token = signAppStoreConnectJwt({ keyId: 'K', issuerId: 'I', privateKeyPem });
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const signedData = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(sigB64, 'base64url');

    const ok = cryptoVerify(
      'sha256',
      Buffer.from(signedData),
      { key: publicKey ?? createPublicKey(privateKeyPem), dsaEncoding: 'ieee-p1363' },
      signature,
    );
    expect(ok).toBe(true);
  });
});

// #257 — build 1 uploaded fine and reached processingState VALID, but
// buildBetaDetail.internalBuildState was MISSING_EXPORT_COMPLIANCE. Apple
// hides such a build from ALL testers with no visible "missing compliance"
// row anywhere in App Store Connect's UI, so processingState VALID alone
// reads as success when it isn't. describeBuildVisibility is the single
// source of truth for whether a build is *actually* visible to testers —
// it must never report "not a problem" for a VALID build whose
// internalBuildState isn't IN_BETA_TESTING.
describe('describeBuildVisibility', () => {
  it('reports a VALID build with internalBuildState IN_BETA_TESTING as visible', () => {
    const { visible, line } = describeBuildVisibility(
      { processingState: 'VALID', expired: false },
      { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'PROCESSING' },
    );
    expect(visible).toBe(true);
    expect(line).toContain('internal=IN_BETA_TESTING');
    expect(line).toContain('external=PROCESSING');
    expect(line).not.toMatch(/problem/i);
  });

  it('flags a VALID build stuck at MISSING_EXPORT_COMPLIANCE as a problem, never as success (#257)', () => {
    const { visible, line } = describeBuildVisibility(
      { processingState: 'VALID', expired: false },
      { internalBuildState: 'MISSING_EXPORT_COMPLIANCE', externalBuildState: null },
    );
    expect(visible).toBe(false);
    expect(line).toMatch(/problem/i);
    expect(line).toContain('internal=MISSING_EXPORT_COMPLIANCE');
    expect(line).toMatch(/not visible to testers/i);
  });

  it('treats a missing buildBetaDetail (fetch failed) as not-visible rather than silently ok', () => {
    const { visible, line } = describeBuildVisibility({ processingState: 'VALID', expired: false }, null);
    expect(visible).toBe(false);
    expect(line).toMatch(/problem/i);
    expect(line).toMatch(/unknown/i);
  });

  it('treats an expired build as not visible even when internalBuildState says IN_BETA_TESTING', () => {
    const { visible, line } = describeBuildVisibility(
      { processingState: 'VALID', expired: true },
      { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'IN_BETA_TESTING' },
    );
    expect(visible).toBe(false);
    expect(line).toMatch(/problem/i);
  });

  it('shows n/a for a missing externalBuildState rather than blank or undefined', () => {
    const { line } = describeBuildVisibility(
      { processingState: 'VALID', expired: false },
      { internalBuildState: 'IN_BETA_TESTING' },
    );
    expect(line).toContain('external=n/a');
  });
});
