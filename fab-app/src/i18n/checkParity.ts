// #217 acceptance criterion 3 ("every non-source locale has a translation
// for every source key, parity machine-checked") + criterion 5(b) (gate
// fails on a mismatch). Pure recursive key-set comparison over JSON
// resource bundles, reported as dot-paths (e.g. "onboarding.consent.download")
// so a missing key is easy to locate.
//
// checkAllLocalesParity iterates every configured locale generically
// (data-driven over the locale registry, ./locales/index.ts) rather than
// hardcoding a specific pair — so adding a new shipped locale to
// LOCALE_BUNDLES is automatically covered by the gate with no changes
// here.

export interface KeyParityResult {
  /** Dot-paths present in `base` but missing from `other`. */
  missingInOther: string[];
  /** Dot-paths present in `other` but missing from `base`. */
  missingInBase: string[];
}

export interface LocaleParityResult {
  locale: string;
  /** Dot-paths present in the source locale but missing from this one. */
  missingInLocale: string[];
  /** Dot-paths present in this locale but missing from the source. */
  missingInSource: string[];
}

export type Bundle = { [key: string]: string | Bundle };

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

/** Checks every locale in `bundles` (except `sourceLocale`) for key parity
 * against the source bundle — the gate-facing entry point. Locale-set-
 * agnostic: works over however many locales `bundles` contains today or in
 * the future, with no per-locale logic. */
export function checkAllLocalesParity(bundles: Record<string, Bundle>, sourceLocale: string): LocaleParityResult[] {
  const source = bundles[sourceLocale];
  if (!source) {
    throw new Error(`checkAllLocalesParity: source locale "${sourceLocale}" not found in bundles`);
  }

  return Object.keys(bundles)
    .filter(locale => locale !== sourceLocale)
    .sort()
    .map(locale => {
      const result = checkKeyParity(source, bundles[locale]);
      return { locale, missingInLocale: result.missingInOther, missingInSource: result.missingInBase };
    });
}
