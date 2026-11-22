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
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const scalar = z.union([z.number(), z.string().max(200), z.boolean()]);

const base = {
  id,
  at: vec3.optional(),
  size: z.union([z.number(), vec3]).optional(),
  color: z.string().max(32).optional(),
  label: text.optional(),
  ask: text.optional(),
  value: scalar.optional(),
  parent: id.optional(),
};

const plain = <T extends string>(t: T) => z.object({ ...base, type: z.literal(t) });

export const GATES = ['and', 'or', 'xor', 'not', 'nand', 'nor', 'xnor'] as const;

const objectSchema = z.discriminatedUnion('type', [
  plain('box'),
  plain('sphere'),
  plain('cylinder'),
  plain('plane'),
  plain('label'),
  plain('grid'),
  plain('group'),
  plain('cell'),
  plain('surface'),
  z.object({ ...base, type: z.literal('gate'), gate: z.enum(GATES) }),
  z.object({ ...base, type: z.literal('wire'), from: id, to: id }),
  z.object({ ...base, type: z.literal('arrow'), from: id.optional(), to: id.optional() }),
]);

const stepSchema = z.object({
  id,
  caption: text.optional(),
  set: z.record(z.string().max(130), scalar).optional(),
  show: z.array(id).optional(),
  hide: z.array(id).optional(),
  move: z.record(id, vec3).optional(),
  pulse: z.array(id).optional(),
  highlight: z.array(id).optional(),
  camera: z.union([id, z.object({ at: vec3, target: vec3.optional() })]).optional(),
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
    s.objects.forEach((o, i) => {
      if (o.parent) known(['objects', i, 'parent'], o.parent);
      if ('from' in o && o.from) known(['objects', i, 'from'], o.from);
      if ('to' in o && o.to) known(['objects', i, 'to'], o.to);
    });
    const stepIds = new Set<string>();
    s.steps.forEach((st, i) => {
      if (stepIds.has(st.id)) bad(['steps', i, 'id'], `duplicate step id "${st.id}"`);
      stepIds.add(st.id);
      for (const k of Object.keys(st.set ?? {})) known(['steps', i, 'set', k], k.split('.')[0]);
      for (const k of Object.keys(st.move ?? {})) known(['steps', i, 'move', k], k);
      for (const verb of ['show', 'hide', 'pulse', 'highlight'] as const)
        st[verb]?.forEach((ref, j) => known(['steps', i, verb, j], ref));
      if (typeof st.camera === 'string') known(['steps', i, 'camera'], st.camera);
      if (st.checkpoint && st.checkpoint.answer >= st.checkpoint.options.length)
        bad(['steps', i, 'checkpoint', 'answer'], 'answer must be an index into options');
    });
    s.controls.forEach((c, i) => known(['controls', i, 'bind'], c.bind.split('.')[0]));
  });

export type DemoObject = z.infer<typeof objectSchema>;
export type DemoStep = z.infer<typeof stepSchema>;
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
