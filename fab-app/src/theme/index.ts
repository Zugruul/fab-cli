// #219 (SPEC-APP.md §9.13): barrel export for the theme layer.

export type {ThemeName, ThemeTokens} from './tokens';
export {THEMES, THEME_NAMES} from './tokens';

export type {Theme} from './useTheme';
export {useTheme, resolveThemeName} from './useTheme';

export {relativeLuminance, contrastRatio, meetsWcagAA} from './contrast';

export type {TokenPair, ContrastFailure} from './tokenContrastGate';
export {CONTRAST_PAIRS, checkTokenContrast} from './tokenContrastGate';
