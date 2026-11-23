/**
 * Shared helpers for presets: plain-TS param guards (the kit carries no zod;
 * the generation side validates with packages/@openmaic/generation/src/demo-presets.ts)
 * and `framesToSpec`, which turns a list of full scene snapshots into a
 * DemoSpec whose steps hold only the changes.
 */
import type {
  CameraTarget,
  Checkpoint,
  DemoObject,
  DemoSpec,
  DemoStep,
  Scalar,
  Vec3,
} from '../core/types';

export const int = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

export const oneOf = <T>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

export const list = (v: unknown, max: number): unknown[] =>
  Array.isArray(v) ? v.slice(0, max) : [];

export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A short name or data item: trimmed string up to `max` chars, or undefined. */
export const short = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** A data item as the schemas allow it: an integer in range or a short string. */
export const item = (v: unknown): number | string | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= -9999 && v <= 99999 ? v : short(v, 6);

/** 0 and 1 would be drawn as logic bits by the kit; a word joiner (U+2060) keeps them plain numbers. */
export const plain = (v: string | number): string | number =>
  v === 0 || v === 1 || v === '0' || v === '1' ? `\u2060${v}` : v;

/** Up to `count` distinct options around `answer`, answer at a position that varies with `seed`. */
export function choices(answer: string, distractors: string[], seed: number, count = 3) {
  const others = [...new Set(distractors.filter((d) => d !== answer))].slice(0, count - 1);
  const at = seed % (others.length + 1);
  const options = [...others.slice(0, at), answer, ...others.slice(at)];
  return { options, answer: at };
}

/** How an object looks in one snapshot. Omitted fields keep their last value; pass '' to clear text. */
export interface Look {
  at?: Vec3;
  value?: Scalar;
  label?: string;
  color?: string;
}

export interface Frame {
  id: string;
  caption?: string;
  /** Every dynamic object that is visible in this snapshot. */
  show: Record<string, Look>;
  pulse?: string[];
  highlight?: string[];
  camera?: CameraTarget;
  checkpoint?: Checkpoint;
}

const same = (a: Vec3 | undefined, b: Vec3 | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.every((n, i) => Math.abs(n - b[i]) < 1e-9));

/**
 * Objects that appear in any frame are dynamic: hidden in frames that do not
 * list them, and they start where they first appear (so they never fly in
 * from the origin). Objects no frame mentions are static decoration.
 */
export function framesToSpec(
  title: string,
  defs: DemoObject[],
  frames: Frame[],
  controls: DemoSpec['controls'] = [],
): DemoSpec {
  const dynamic = new Set(frames.flatMap((f) => Object.keys(f.show)));
  const first = new Map<string, Look>();
  for (const frame of frames)
    for (const [id, look] of Object.entries(frame.show)) if (!first.has(id)) first.set(id, look);

  const objects: DemoObject[] = defs.map((def) => {
    if (!dynamic.has(def.id)) return def;
    const look = first.get(def.id)!;
    const out: DemoObject = { ...def };
    if (look.at) out.at = look.at;
    if (look.value !== undefined) out.value = look.value;
    if (look.label !== undefined) out.label = look.label;
    if (look.color !== undefined) out.color = look.color;
    if (!(def.id in frames[0].show)) out.hidden = true;
    return out;
  });

  const current = new Map<string, Look & { visible: boolean }>();
  for (const o of objects) {
    if (dynamic.has(o.id))
      current.set(o.id, {
        at: o.at,
        value: o.value,
        label: o.label,
        color: o.color,
        visible: !o.hidden,
      });
  }
  const ids = new Set<string>();
  const steps: DemoStep[] = frames.map((frame) => {
    let id = frame.id;
    for (let n = 2; ids.has(id); n++) id = `${frame.id}-${n}`;
    ids.add(id);
    const step: DemoStep = { id };
    const set: Record<string, Scalar> = {};
    const move: Record<string, Vec3> = {};
    const show: string[] = [];
    const hide: string[] = [];
    for (const [oid, now] of current) {
      const look = frame.show[oid];
      if (!look) {
        if (now.visible) hide.push(oid);
        now.visible = false;
        continue;
      }
      if (!now.visible) show.push(oid);
      now.visible = true;
      if (look.at && !same(look.at, now.at)) move[oid] = now.at = look.at;
      if (look.value !== undefined && look.value !== now.value)
        set[`${oid}.value`] = now.value = look.value;
      if (look.label !== undefined && look.label !== now.label)
        set[`${oid}.label`] = now.label = look.label;
      if (look.color !== undefined && look.color !== now.color)
        set[`${oid}.color`] = now.color = look.color;
    }
    if (frame.caption) step.caption = frame.caption;
    if (Object.keys(set).length) step.set = set;
    if (Object.keys(move).length) step.move = move;
    if (show.length) step.show = show;
    if (hide.length) step.hide = hide;
    if (frame.pulse?.length) step.pulse = frame.pulse;
    if (frame.highlight?.length) step.highlight = frame.highlight;
    if (frame.camera !== undefined) step.camera = frame.camera;
    if (frame.checkpoint) step.checkpoint = frame.checkpoint;
    return step;
  });
  return { version: 1, kind: 'scene3d', title, objects, steps, controls };
}
