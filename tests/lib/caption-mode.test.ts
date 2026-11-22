import { describe, it, expect } from 'vitest';
import {
  boxToCaptionPos,
  clampCaptionPos,
  isTypingTarget,
  nextCaptionMode,
  normalizeCaptionMode,
} from '@/lib/caption-mode';

describe('caption mode', () => {
  it('cycles band, float, pill, off and wraps', () => {
    expect(nextCaptionMode('band')).toBe('float');
    expect(nextCaptionMode('float')).toBe('pill');
    expect(nextCaptionMode('pill')).toBe('off');
    expect(nextCaptionMode('off')).toBe('band');
  });

  it('falls back to band for an unknown persisted value', () => {
    expect(normalizeCaptionMode('float')).toBe('float');
    expect(normalizeCaptionMode('sideways')).toBe('band');
    expect(normalizeCaptionMode(undefined)).toBe('band');
  });

  it('clamps positions into 0..1 and rejects junk', () => {
    expect(clampCaptionPos({ x: -3, y: 9 })).toEqual({ x: 0, y: 1 });
    expect(clampCaptionPos({ x: Number.NaN, y: 0.4 })).toEqual({ x: 0, y: 0.4 });
    expect(clampCaptionPos(null)).toEqual({ x: 0, y: 1 });
  });

  it('turns a dropped box into a clamped fraction of the free space', () => {
    const stage = { left: 100, top: 50, width: 1000, height: 600 };
    const bubble = { width: 400, height: 100 };
    expect(boxToCaptionPos({ ...bubble, left: 400, top: 300 }, stage)).toEqual({ x: 0.5, y: 0.5 });
    expect(boxToCaptionPos({ ...bubble, left: -50, top: 900 }, stage)).toEqual({ x: 0, y: 1 });
    expect(boxToCaptionPos({ width: 1200, height: 100, left: 0, top: 50 }, stage).x).toBe(0);
  });

  it('treats inputs and contentEditable as typing, not buttons', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
