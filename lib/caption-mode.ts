/** How the agent's speech caption is shown. Persisted in the settings store. */
export const CAPTION_MODES = ['band', 'float', 'pill', 'off'] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];
export const DEFAULT_CAPTION_MODE: CaptionMode = 'band';

/** Floating bubble position as 0..1 fractions of the stage's free space (0,0 = top-left). */
export interface CaptionFloatPos {
  x: number;
  y: number;
}
export const DEFAULT_CAPTION_FLOAT_POS: CaptionFloatPos = { x: 0, y: 1 };

export function normalizeCaptionMode(value: unknown): CaptionMode {
  return CAPTION_MODES.includes(value as CaptionMode)
    ? (value as CaptionMode)
    : DEFAULT_CAPTION_MODE;
}

export function nextCaptionMode(mode: CaptionMode): CaptionMode {
  return CAPTION_MODES[(CAPTION_MODES.indexOf(mode) + 1) % CAPTION_MODES.length];
}

const unit = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

export function clampCaptionPos(pos: Partial<CaptionFloatPos> | null | undefined): CaptionFloatPos {
  return pos ? { x: unit(pos.x), y: unit(pos.y) } : DEFAULT_CAPTION_FLOAT_POS;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a dropped bubble sits inside the stage, as a clamped fraction of the free space. */
export function boxToCaptionPos(bubble: Box, stage: Box): CaptionFloatPos {
  const freeW = stage.width - bubble.width;
  const freeH = stage.height - bubble.height;
  return clampCaptionPos({
    x: freeW > 0 ? (bubble.left - stage.left) / freeW : 0,
    y: freeH > 0 ? (bubble.top - stage.top) / freeH : 0,
  });
}

/** True while the user is typing, so a bare-letter shortcut must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.isContentEditable);
}
