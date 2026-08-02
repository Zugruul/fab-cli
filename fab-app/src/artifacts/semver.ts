// Minimal semver comparison — enough for §9.3's two checks (a caret range
// membership test, and a plain >= comparison for app-min-version). This is
// deliberately narrow: it parses the leading `major.minor.patch` and
// ignores prerelease/build metadata, and satisfiesRange only understands a
// bare "^x.y.z" range or an exact "x.y.z" match (mirrors
// manifest-schema/src/modelPack.ts's SPDX-format-only comment: real ranges
// like ">=1.0.0 <2.0.0" or "~x.y" are out of scope for v0.1.0).

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    throw new Error(`not a parseable semver-like version: "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = parseVersion(a);
  const [b1, b2, b3] = parseVersion(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    const base = trimmed.slice(1);
    const [baseMajor] = parseVersion(base);
    const [versionMajor] = parseVersion(version);
    if (versionMajor !== baseMajor) return false;
    return compareVersions(version, base) >= 0;
  }
  return compareVersions(version, trimmed) === 0;
}
