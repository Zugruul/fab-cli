// #219 (SPEC-APP.md §9.13) acceptance criterion 4(b): pure WCAG 2.x
// relative-luminance + contrast-ratio implementation
// (https://www.w3.org/TR/WCAG21/#contrast-minimum), used to gate every
// semantic token pair (tokenContrastGate.ts) at 4.5:1 for normal text (the
// AA threshold) — no dependency needed, the formula is small and stable.

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    throw new Error(`contrast: expected a 6-digit hex color, got "${hex}"`);
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

/** WCAG relative luminance (0 = black, 1 = white) for a 6-digit hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG contrast ratio between two colors, symmetric, range [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x AA threshold: 4.5:1 for normal text, 3:1 for large text
 * (>=18pt, or >=14pt bold). */
export function meetsWcagAA(foregroundHex: string, backgroundHex: string, isLargeText = false): boolean {
  const threshold = isLargeText ? 3 : 4.5;
  return contrastRatio(foregroundHex, backgroundHex) >= threshold;
}
