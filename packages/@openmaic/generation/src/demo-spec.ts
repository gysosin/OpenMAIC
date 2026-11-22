/**
 * DemoSpec v1: the JSON the model fills in and the demo-kit runtime renders (PLAN.md C3).
 *
 * Runtime contract (kit <-> host):
 * - Object ids and step ids are the spec's own `id` strings. The kit renders object `x` as DOM/scene
 *   id `x`; click-to-ask reports it. Step ids are unique; `set` keys are `<objectId>.<prop>`.
 * - Host -> kit: `{type:'SET_WIDGET_STATE', state:{step:'<stepId>'}}` jumps to that step.
 * - Kit -> host (window.parent.postMessage):
 *   `{type:'DEMO_STEP_CHANGED', step}`          learner scrubbed or pressed next/back
 *   `{type:'DEMO_ASK', objectId, step}`          learner clicked an object with an `ask`
 *   `{type:'DEMO_CHECKPOINT', stepId, correct}`  checkpoint answered (correct: boolean)
 * - Import only the types from this file; the kit must not import runtime code.
 */
import { z } from 'zod';

const id = z.string().min(1).max(64);
const text = z.string().max(500);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const scalar = z.union([z.number().finite(), z.string().max(200), z.boolean()]);

/** Named colours resolve per theme in the kit (theme.ts); a raw colour must be #rrggbb. */
export const COLOR_NAMES = [
  'accent',
  'blue',
  'orange',
  'teal',
  'yellow',
  'vermilion',
  'purple',
  'sky',
  'neutral',
] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const isColor = (c: string) => (COLOR_NAMES as readonly string[]).includes(c) || HEX.test(c);
const color = z.string().max(32).refine(isColor, 'must be a named colour or #rrggbb');

export const PRIMITIVES = [
  'box',
  'sphere',
  'cylinder',
  'plane',
  'label',
  'grid',
  'group',
  'cell',
  'surface',
  'gate',
  'wire',
  'arrow',
] as const;
export const GATES = ['and', 'or', 'xor', 'not', 'nand', 'nor', 'xnor', 'buf'] as const;
/** Props a step `set` key or a control `bind` may target: `<objectId>.<prop>`. */
export const SET_PROPS = ['value', 'label', 'color', 'visible', 'x', 'y', 'z', 'scale'] as const;

const objectSchema = z.object({
  id,
  type: z.enum(PRIMITIVES),
  at: vec3.optional(),
  /** Euler angles in degrees. */
  rotation: vec3.optional(),
  size: z.union([z.number().finite(), vec3]).optional(),
  color: color.optional(),
  label: text.optional(),
  ask: text.optional(),
  value: scalar.optional(),
  hidden: z.boolean().optional(),
  /** Id of a `group` object; position is then relative to the group. */
  parent: id.optional(),
  gate: z.enum(GATES).optional(),
  /** wire / arrow endpoints: an object id or a point. */
  from: z.union([id, vec3]).optional(),
  to: z.union([id, vec3]).optional(),
  /** surface: row-major heights, rows along z, columns along x. */
  heights: z.array(z.array(z.number().finite()).max(128)).max(128).optional(),
});

const stepSchema = z.object({
  id,
  caption: text.optional(),
  set: z.record(z.string().max(130), scalar).optional(),
  show: z.array(id).optional(),
  hide: z.array(id).optional(),
  move: z.record(id, vec3).optional(),
  pulse: z.array(id).optional(),
  highlight: z.array(id).optional(),
  /** Object id to frame, "overview", or an explicit pose. */
  camera: z.union([id, z.object({ position: vec3, target: vec3 })]).optional(),
  checkpoint: z
    .object({
      question: text,
      options: z.array(text).min(2).max(6),
      answer: z.number().int().min(0),
    })
    .optional(),
});

const controlSchema = z.object({
  id,
  type: z.enum(['toggle', 'slider']),
  bind: z.string().min(1).max(130),
  label: text.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

const specSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['scene3d', 'flow', 'preset']),
    preset: id.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    title: text,
    objects: z.array(objectSchema).max(500).default([]),
    steps: z.array(stepSchema).max(100).default([]),
    controls: z.array(controlSchema).max(20).default([]),
  })
  .superRefine((s, ctx) => {
    const bad = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (s.kind === 'preset') {
      if (!s.preset) bad(['preset'], 'preset name is required when kind is "preset"');
    } else {
      if (!s.objects.length) bad(['objects'], 'at least one object is required');
      if (!s.steps.length) bad(['steps'], 'at least one step is required');
    }
    const ids = new Set<string>();
    s.objects.forEach((o, i) => {
      if (ids.has(o.id)) bad(['objects', i, 'id'], `duplicate object id "${o.id}"`);
      ids.add(o.id);
    });
    const known = (path: (string | number)[], ref: string) => {
      if (!ids.has(ref)) bad(path, `unknown object id "${ref}"`);
    };
    const parentOf = new Map(s.objects.map((o) => [o.id, o.parent]));
    s.objects.forEach((o, i) => {
      if (o.type === 'gate' && !o.gate) bad(['objects', i, 'gate'], 'gate type is required');
      if (o.type === 'wire' && (!o.from || !o.to))
        bad(['objects', i, o.from ? 'to' : 'from'], 'wire needs from and to');
      if (o.parent) known(['objects', i, 'parent'], o.parent);
      for (const end of ['from', 'to'] as const) {
        const ref = o[end];
        if (typeof ref === 'string') known(['objects', i, end], ref);
      }
      // Walk up the parent chain; one longer than the object count must loop.
      let up = o.parent;
      for (let n = 0; up && n <= s.objects.length; n++) {
        if (up === o.id || n === s.objects.length) {
          bad(['objects', i, 'parent'], `parent cycle through "${o.id}"`);
          break;
        }
        up = parentOf.get(up);
      }
    });
    // "<objectId>.<prop>": the prop is the text after the last dot, as the kit reads it.
    const target = (path: (string | number)[], key: string) => {
      const dot = key.lastIndexOf('.');
      known(path, key.slice(0, dot));
      if (!(SET_PROPS as readonly string[]).includes(key.slice(dot + 1)))
        bad(path, `prop must be one of ${SET_PROPS.join(', ')}`);
    };
    const stepIds = new Set<string>();
    s.steps.forEach((st, i) => {
      if (stepIds.has(st.id)) bad(['steps', i, 'id'], `duplicate step id "${st.id}"`);
      stepIds.add(st.id);
      for (const [k, v] of Object.entries(st.set ?? {})) {
        target(['steps', i, 'set', k], k);
        if (k.endsWith('.color') && !(typeof v === 'string' && isColor(v)))
          bad(['steps', i, 'set', k], 'must be a named colour or #rrggbb');
      }
      for (const k of Object.keys(st.move ?? {})) known(['steps', i, 'move', k], k);
      for (const verb of ['show', 'hide', 'pulse', 'highlight'] as const)
        st[verb]?.forEach((ref, j) => known(['steps', i, verb, j], ref));
      if (typeof st.camera === 'string' && st.camera !== 'overview') known(['steps', i, 'camera'], st.camera);
      if (st.checkpoint && st.checkpoint.answer >= st.checkpoint.options.length)
        bad(['steps', i, 'checkpoint', 'answer'], 'answer must be an index into options');
    });
    s.controls.forEach((c, i) => target(['controls', i, 'bind'], c.bind));
  });

export type Vec3 = [number, number, number];
export type Scalar = number | string | boolean;
export type PrimitiveType = (typeof PRIMITIVES)[number];
export type GateKind = (typeof GATES)[number];
export type ColorName = (typeof COLOR_NAMES)[number];
export type DemoObject = z.infer<typeof objectSchema>;
export type DemoStep = z.infer<typeof stepSchema>;
export type Checkpoint = NonNullable<DemoStep['checkpoint']>;
export type CameraTarget = NonNullable<DemoStep['camera']>;
export type DemoControl = z.infer<typeof controlSchema>;
export type DemoSpec = z.infer<typeof specSchema>;

export type DemoSpecResult =
  | { ok: true; spec: DemoSpec }
  | { ok: false; errors: { path: string; message: string }[] };

/** Validate untrusted model output. Unknown fields are dropped; errors carry dotted paths. */
export function validateDemoSpec(raw: unknown): DemoSpecResult {
  const r = specSchema.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
