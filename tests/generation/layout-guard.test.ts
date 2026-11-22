import { describe, expect, it } from 'vitest';
import { applyLayoutGuard } from '../../packages/@openmaic/generation/src/layout-guard';
import fixture from './fixtures/clipped-slide-elements.json';

type El = {
  id: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
  content?: string;
};
const H = 562.5;
const MARGIN = 50;
const els = fixture as El[];
const text = (id: string, top: number, width: number, height: number, html: string): El => ({
  id,
  type: 'text',
  left: 60,
  top,
  width,
  height,
  content: html,
});
const bottom = (e: El) => e.top + e.height;

describe('applyLayoutGuard', () => {
  it('fixes the recorded clipped slide: text fits its lines and nothing passes the bottom margin', () => {
    const out = applyLayoutGuard(els, H) as El[];
    const warn = out.find((e) => e.id === 'text_yqRfNzkb')!;
    expect(warn.height).toBeGreaterThanOrEqual(70); // wraps to 2 lines at 16px
    expect(Math.max(...out.map(bottom))).toBeLessThanOrEqual(H - MARGIN);
    const box = out.find((e) => e.id === 'shape_JTiPSSf5')!;
    expect(bottom(box)).toBeGreaterThanOrEqual(bottom(warn)); // the box still wraps its text
  });

  it('is idempotent', () => {
    const once = applyLayoutGuard(els, H);
    expect(applyLayoutGuard(once, H)).toEqual(once);
  });

  it('leaves an already-fitting slide unchanged', () => {
    const ok = [text('a', 60, 800, 46, '<p style="font-size:16px">short</p>')];
    expect(applyLayoutGuard(ok, H)).toEqual(ok);
  });

  it('counts CJK characters as full-width', () => {
    const cjk = '这是一个很长的中文句子用来测试换行估算是否正确'.repeat(2); // 46 chars
    const out = applyLayoutGuard(
      [text('c', 60, 400, 46, `<p style="font-size:16px">${cjk}</p>`)],
      H,
    ) as El[];
    expect(out[0].height).toBe(70); // 736px over 380px => 2 lines
  });

  it('grows a wrapped long title and pushes the element below it down', () => {
    const title = 'A very long title that cannot possibly fit on one single line of the slide here';
    const out = applyLayoutGuard(
      [
        text('t', 50, 500, 70, `<p style="font-size:32px"><strong>${title}</strong></p>`),
        text('s', 125, 500, 46, '<p style="font-size:16px">sub</p>'),
      ],
      H,
    ) as El[];
    expect(out[0].height).toBeGreaterThan(70);
    expect(out[1].top).toBeGreaterThanOrEqual(bottom(out[0]));
  });
});
