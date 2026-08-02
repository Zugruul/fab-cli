// #217 acceptance criterion 3 ("pt-BR has a translation for every en key,
// parity machine-checked") + criterion 5(b) (gate fails on a mismatch).
// Pure recursive key-set comparison over the two JSON resource bundles,
// reported as dot-paths (e.g. "onboarding.consent.download") so a missing
// key is easy to locate.

export interface KeyParityResult {
  /** Dot-paths present in `base` but missing from `other`. */
  missingInOther: string[];
  /** Dot-paths present in `other` but missing from `base`. */
  missingInBase: string[];
}

type Bundle = { [key: string]: string | Bundle };

function collectKeyPaths(bundle: Bundle, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      paths.push(...collectKeyPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

export function checkKeyParity(base: Bundle, other: Bundle): KeyParityResult {
  const basePaths = new Set(collectKeyPaths(base));
  const otherPaths = new Set(collectKeyPaths(other));

  return {
    missingInOther: [...basePaths].filter(path => !otherPaths.has(path)).sort(),
    missingInBase: [...otherPaths].filter(path => !basePaths.has(path)).sort(),
  };
}
