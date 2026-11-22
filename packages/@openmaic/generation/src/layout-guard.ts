/**
 * Deterministic slide layout guard (fork plan A3, layer 2).
 *
 * The model is asked to pick text heights from a lookup table but nothing checks
 * the result, so wrapped text spills out of its box and off the slide. This pass
 * (1) raises text heights to the estimated wrapped line count, moving what sits
 * below down, and (2) squeezes vertical gaps so nothing passes canvas height minus
 * the bottom margin. Pure and idempotent; fitting slides come back unchanged.
 */

interface Box {
  type?: string;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  content?: string;
  lineHeight?: number;
}

const BOTTOM_MARGIN = 50;
const PAD = 20; // text element padding (10px each side)
const EXTRA = 2; // lookup-table slack: 1 line @16px = 46
const DEFAULT_FONT = 16;
const DEFAULT_LINE_HEIGHT = 1.5;
// ponytail: char-width heuristic, not real font metrics; swap for a canvas measure if it drifts.
const LATIN_EM = 0.55;
const CJK = /[　-鿿ぁ-ヿ가-힯＀-￯]/;

function estimateTextHeight(el: Box): number {
  const lh = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const avail = Math.max((el.width ?? 0) - PAD, 1);
  const paras = (el.content ?? '').match(/<(p|h[1-6])[\s>][\s\S]*?<\/\1>/gi) ?? [el.content ?? ''];
  let total = PAD + EXTRA;
  for (const p of paras) {
    const fs = Math.max(
      ...[...p.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])),
      DEFAULT_FONT * Number(!/font-size/.test(p)),
    );
    const plain = p
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/g, '_');
    let w = 0;
    for (const ch of plain) w += CJK.test(ch) ? fs : fs * LATIN_EM;
    total += Math.max(1, Math.ceil(w / avail)) * fs * lh;
  }
  return Math.ceil(total);
}

export function applyLayoutGuard<T extends Box>(elements: T[], canvasHeight: number): T[] {
  const out = elements.map((e) => ({ ...e }));

  // 1. Grow short text boxes top-down; containers grow, elements below shift.
  const byTop = out
    .filter((e) => typeof e.top === 'number' && typeof e.height === 'number')
    .sort((a, b) => a.top! - b.top!);
  for (const el of byTop) {
    if (el.type !== 'text') continue;
    const need = estimateTextHeight(el);
    const d = need - el.height!;
    if (d <= 0) continue;
    const oldBottom = el.top! + el.height!;
    const l = el.left ?? 0;
    const r = l + (el.width ?? 0);
    el.height = need;
    for (const o of byTop) {
      if (o === el) continue;
      if (o.top! >= oldBottom) o.top = o.top! + d;
      else if (
        o.type !== 'text' &&
        o.top! <= el.top! &&
        o.top! + o.height! >= oldBottom &&
        (o.left ?? 0) <= l &&
        (o.left ?? 0) + (o.width ?? 0) >= r
      )
        o.height = o.height! + d; // shape/box wrapping this text
    }
  }

  // 2. Squeeze the gaps between vertical bands to fit above the bottom margin.
  const limit = canvasHeight - BOTTOM_MARGIN;
  const maxBottom = Math.max(...byTop.map((e) => e.top! + e.height!), 0);
  if (maxBottom > limit) {
    const bands: Array<{ start: number; end: number }> = [];
    for (const e of byTop) {
      const last = bands[bands.length - 1];
      if (last && e.top! <= last.end) last.end = Math.max(last.end, e.top! + e.height!);
      else bands.push({ start: e.top!, end: e.top! + e.height! });
    }
    const gaps = bands.slice(1).map((b, i) => b.start - bands[i].end);
    const slack = gaps.reduce((a, b) => a + b, 0);
    if (slack > 0) {
      const keep = 1 - Math.min(1, (maxBottom - limit) / slack);
      const shiftOf = (top: number) => {
        let s = 0;
        bands.slice(1).forEach((b, i) => {
          if (top >= b.start) s += gaps[i] * (1 - keep);
        });
        return Math.ceil(s);
      };
      for (const e of byTop) e.top = e.top! - shiftOf(e.top!);
    }
    // Gaps alone were not enough: scale tops and non-text heights (text keeps the
    // height its lines need; its 10px padding absorbs the small overlap).
    const m = byTop[0].top!;
    const k = Math.min(
      1,
      ...byTop.map((e) => {
        const text = e.type === 'text';
        return (limit - m - (text ? e.height! : 0)) / (e.top! - m + (text ? 0 : e.height!) || 1);
      }),
    );
    if (Math.max(...byTop.map((e) => e.top! + e.height!)) > limit && k > 0.5) {
      const texts = byTop.filter((t) => t.type === 'text');
      const inside = (b: T, t: T) =>
        t.left! >= b.left! &&
        t.left! + t.width! <= b.left! + b.width! &&
        t.top! >= b.top! &&
        t.top! < b.top! + b.height!;
      const wrapped = new Map(
        byTop.filter((b) => b.type !== 'text').map((b) => [b, texts.filter((t) => inside(b, t))]),
      );
      for (const e of byTop) {
        e.top = Math.floor(m + (e.top! - m) * k);
        if (e.type !== 'text') e.height = Math.floor(e.height! * k);
      }
      // A box that wrapped text must still reach the bottom of that text.
      for (const [b, ts] of wrapped)
        for (const t of ts) b.height = Math.max(b.height!, t.top! + t.height! - b.top!);
    }
  }
  return out;
}
