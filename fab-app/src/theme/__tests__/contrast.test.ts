// #219 acceptance criterion 4(b): the merge gate must assert every semantic
// token pair meets WCAG AA (4.5:1 normal text / 3:1 large text), via a pure
// contrast-ratio function this suite unit-tests directly — no new
// dependency, the WCAG 2.x relative-luminance + contrast-ratio formulas
// (https://www.w3.org/TR/WCAG21/#contrast-minimum) are implemented in
// ../contrast.ts.
//
// Expected ratios below are computed independently (by hand, against the
// spec formula, not by importing the SUT to generate its own fixtures) so
// this suite is a real check of the math, not a tautology:
//  - white/black is the canonical maximum ratio, exactly 21:1.
//  - #767676 on #ffffff ≈ 4.54:1 — just above the 4.5 AA-normal threshold.
//  - #777777 on #ffffff ≈ 4.48:1 — just below 4.5 (fails normal), but above
//    3 (passes large-text AA).
//  - #aaaaaa on #ffffff ≈ 2.32:1 — fails both normal and large-text AA.

import { relativeLuminance, contrastRatio, meetsWcagAA } from '../contrast';

describe('relativeLuminance (pure WCAG math)', () => {
  it('is 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('is 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('is monotonic: a lighter gray has higher luminance than a darker one', () => {
    expect(relativeLuminance('#aaaaaa')).toBeGreaterThan(relativeLuminance('#767676'));
  });
});

describe('contrastRatio (pure WCAG math)', () => {
  it('is exactly 21:1 for white on black (the canonical maximum)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('is 1:1 for a color against itself', () => {
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
    expect(contrastRatio('#4a90d9', '#4a90d9')).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#333333', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#333333'), 5);
  });

  it('matches the independently-computed ratio for a known boundary color', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#aaaaaa', '#ffffff')).toBeCloseTo(2.32, 1);
  });
});

describe('meetsWcagAA (threshold logic)', () => {
  it('passes normal text at exactly the 4.5:1 boundary and above', () => {
    expect(meetsWcagAA('#767676', '#ffffff')).toBe(true); // ~4.54:1
    expect(meetsWcagAA('#ffffff', '#000000')).toBe(true); // 21:1
  });

  it('fails normal text just below the 4.5:1 boundary', () => {
    expect(meetsWcagAA('#777777', '#ffffff')).toBe(false); // ~4.48:1
  });

  it('applies the relaxed 3:1 threshold for large text', () => {
    expect(meetsWcagAA('#777777', '#ffffff', true)).toBe(true); // ~4.48:1 >= 3
    expect(meetsWcagAA('#aaaaaa', '#ffffff', true)).toBe(false); // ~2.32:1 < 3
  });

  it('fails both thresholds for a low-contrast pair (broken-token fixture)', () => {
    expect(meetsWcagAA('#aaaaaa', '#ffffff')).toBe(false);
    expect(meetsWcagAA('#aaaaaa', '#ffffff', true)).toBe(false);
  });
});
