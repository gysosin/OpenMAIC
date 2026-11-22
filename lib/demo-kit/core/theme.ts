/**
 * Flat theme tokens for the stage and the chrome (no gradients).
 *
 * Neutrals follow the true-neutral OKLCH ramp in the house palette guide
 * (deep black: canvas #000 / panel #0c0c0c / text #e8e8e8; light: #fafafa /
 * #fff / #171717). The accent is the classroom violet (app/globals.css
 * --primary). Object colours are the guide's adapted Okabe-Ito families, the
 * dark-theme column lifted for a black canvas.
 */
import type { ColorName } from './types';

export type ThemeName = 'light' | 'dark';

export interface Theme {
  name: ThemeName;
  canvas: string;
  panel: string;
  raised: string;
  line: string;
  text: string;
  muted: string;
  /** Inactive bits, idle wires, neutral solids. */
  off: string;
  /** Logic 1, the active step, primary emphasis. */
  accent: string;
  onAccent: string;
  highlight: string;
  correct: string;
  wrong: string;
  grid: string;
  shadowOpacity: number;
  hemiSky: string;
  hemiGround: string;
  named: Record<ColorName, string>;
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    canvas: '#000000',
    panel: '#0c0c0c',
    raised: '#181818',
    line: '#2a2a2a',
    text: '#e8e8e8',
    muted: '#a3a3a3',
    off: '#3a3a3e',
    accent: '#9a5cf5',
    onAccent: '#ffffff',
    highlight: '#f1a340',
    correct: '#37c89a',
    wrong: '#ef8660',
    grid: '#1c1c1c',
    shadowOpacity: 0.55,
    hemiSky: '#ffffff',
    hemiGround: '#1a1a1a',
    named: {
      accent: '#9a5cf5',
      blue: '#5c9edb',
      orange: '#f1a340',
      teal: '#37c89a',
      yellow: '#f0e442',
      vermilion: '#ef8660',
      purple: '#dd9fc6',
      sky: '#70cbe8',
      neutral: '#8a8a8a',
    },
  },
  light: {
    name: 'light',
    canvas: '#fafafa',
    panel: '#ffffff',
    raised: '#f1f1f1',
    line: '#e2e2e2',
    text: '#171717',
    muted: '#595959',
    off: '#d9d9de',
    accent: '#722ed1',
    onAccent: '#ffffff',
    highlight: '#c97a00',
    correct: '#007a5a',
    wrong: '#b74900',
    grid: '#e6e6e6',
    shadowOpacity: 0.14,
    hemiSky: '#ffffff',
    hemiGround: '#d8d8d8',
    named: {
      accent: '#722ed1',
      blue: '#0072b2',
      orange: '#e08a1e',
      teal: '#009e73',
      yellow: '#d9c400',
      vermilion: '#d55e00',
      purple: '#a6538c',
      sky: '#26879e',
      neutral: '#9a9a9a',
    },
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A spec colour (named or #rrggbb) for this theme; anything else falls back. */
export function resolveColor(theme: Theme, color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  if (color in theme.named) return theme.named[color as ColorName];
  return HEX.test(color) ? color : fallback;
}

export function initialTheme(): ThemeName {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** CSS custom properties for the chrome, so labels and controls follow the theme. */
export function cssVariables(theme: Theme): string {
  const vars: Record<string, string> = {
    canvas: theme.canvas,
    panel: theme.panel,
    raised: theme.raised,
    line: theme.line,
    text: theme.text,
    muted: theme.muted,
    accent: theme.accent,
    'on-accent': theme.onAccent,
    highlight: theme.highlight,
    correct: theme.correct,
    wrong: theme.wrong,
  };
  return Object.entries(vars)
    .map(([k, v]) => `--dk-${k}:${v};`)
    .join('');
}
