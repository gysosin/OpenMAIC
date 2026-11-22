/**
 * Pure step model: a spec becomes one full state per step.
 *
 * Step i's state is the objects' initial state with the verbs of steps 0..i
 * applied in order, then logic values derived from wires and gates. Persistent
 * verbs (set, show, hide, move, camera) carry forward; transient ones
 * (pulse, highlight, caption, checkpoint) belong to their step only. Going back
 * or scrubbing is therefore just showing an earlier state: nothing is undone
 * by hand. The gsap layer (motion.ts) tweens between neighbouring states.
 */
import type { CameraTarget, Checkpoint, DemoObject, DemoSpec, GateKind, Scalar, Vec3 } from './types';

export interface ObjectState {
  visible: boolean;
  at: Vec3;
  scale: number;
  value?: Scalar;
  label?: string;
  color?: string;
}

export interface StepState {
  index: number;
  id: string;
  caption: string;
  objects: Record<string, ObjectState>;
  highlight: string[];
  pulse: string[];
  camera: CameraTarget;
  checkpoint?: Checkpoint;
}

const ORIGIN: Vec3 = [0, 0, 0];

export function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export function initialObjects(objects: DemoObject[]): Record<string, ObjectState> {
  const out: Record<string, ObjectState> = {};
  for (const object of objects) {
    out[object.id] = {
      visible: object.hidden !== true,
      at: isVec3(object.at) ? [...object.at] : [...ORIGIN],
      scale: 1,
      value: object.value,
      label: object.label,
      color: object.color,
    };
  }
  return out;
}

/** Applies one `"<id>.<prop>": value` assignment; unknown ids or props are ignored. */
export function applyAssignment(
  objects: Record<string, ObjectState>,
  key: string,
  value: Scalar,
): void {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return;
  const state = objects[key.slice(0, dot)];
  if (!state) return;
  const prop = key.slice(dot + 1);
  const num = typeof value === 'number' ? value : Number(value);
  switch (prop) {
    case 'value':
      state.value = value;
      break;
    case 'label':
    case 'color':
      state[prop] = String(value);
      break;
    case 'visible':
      state.visible = value === true || value === 1 || value === 'true';
      break;
    case 'x':
    case 'y':
    case 'z':
      if (Number.isFinite(num)) state.at[{ x: 0, y: 1, z: 2 }[prop]] = num;
      break;
    case 'scale':
      if (Number.isFinite(num) && num >= 0) state.scale = num;
      break;
  }
}

export function truthy(value: Scalar | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

const GATES: Record<GateKind, (inputs: boolean[]) => boolean> = {
  and: (i) => i.length > 0 && i.every(Boolean),
  or: (i) => i.some(Boolean),
  xor: (i) => i.filter(Boolean).length % 2 === 1,
  nand: (i) => !(i.length > 0 && i.every(Boolean)),
  nor: (i) => !i.some(Boolean),
  xnor: (i) => i.filter(Boolean).length % 2 === 0,
  not: (i) => !i[0],
  buf: (i) => Boolean(i[0]),
};

/**
 * Wires carry their source's value; gates compute from their incoming wires;
 * any other object fed by a wire shows that wire's value. A wire is visible
 * only when both of its endpoints are. Iterates to a fixed point (circuits
 * are small, and a cycle simply stops after objects.length rounds).
 */
export function deriveValues(objects: DemoObject[], states: Record<string, ObjectState>): void {
  const wires = objects.filter((o) => o.type === 'wire');
  if (wires.length === 0) return;
  const incoming = new Map<string, DemoObject[]>();
  for (const wire of wires) {
    if (typeof wire.to !== 'string') continue;
    incoming.set(wire.to, [...(incoming.get(wire.to) ?? []), wire]);
  }
  for (let round = 0; round <= objects.length; round++) {
    let changed = false;
    const update = (id: string, value: Scalar | undefined) => {
      if (states[id] && states[id].value !== value) {
        states[id].value = value;
        changed = true;
      }
    };
    for (const wire of wires) {
      if (typeof wire.from === 'string') update(wire.id, states[wire.from]?.value);
    }
    for (const object of objects) {
      const feeds = incoming.get(object.id);
      if (!feeds || object.type === 'wire') continue;
      const values = feeds.map((w) => states[w.id]?.value);
      if (object.type === 'gate') {
        if (values.some((v) => v === undefined)) update(object.id, undefined);
        else update(object.id, GATES[object.gate ?? 'buf'](values.map(truthy)) ? 1 : 0);
      } else {
        update(object.id, values[0]);
      }
    }
    if (!changed) break;
  }
  for (const wire of wires) {
    const end = (ref: DemoObject['from']) => typeof ref !== 'string' || states[ref]?.visible !== false;
    const state = states[wire.id];
    if (state && !(end(wire.from) && end(wire.to))) state.visible = false;
  }
}

function clone(objects: Record<string, ObjectState>): Record<string, ObjectState> {
  const out: Record<string, ObjectState> = {};
  for (const [id, state] of Object.entries(objects)) out[id] = { ...state, at: [...state.at] };
  return out;
}

/** One state per step, in order. A spec without steps gets a single `start` step. */
export function buildStates(spec: Pick<DemoSpec, 'objects' | 'steps'>): StepState[] {
  const objects = spec.objects ?? [];
  const steps = spec.steps?.length ? spec.steps : [{ id: 'start' }];
  // Persistent object state before derivation, so a derived value never
  // leaks into the next step as if it had been `set`.
  let base = initialObjects(objects);
  let camera: CameraTarget = 'overview';
  return steps.map((step, index) => {
    base = clone(base);
    for (const [key, value] of Object.entries(step.set ?? {})) applyAssignment(base, key, value);
    for (const id of step.show ?? []) if (base[id]) base[id].visible = true;
    for (const id of step.hide ?? []) if (base[id]) base[id].visible = false;
    for (const [id, at] of Object.entries(step.move ?? {})) {
      if (base[id] && isVec3(at)) base[id].at = [...at];
    }
    if (step.camera !== undefined) camera = step.camera;
    const derived = clone(base);
    deriveValues(objects, derived);
    return {
      index,
      id: step.id,
      caption: step.caption ?? step.checkpoint?.question ?? '',
      objects: derived,
      highlight: (step.highlight ?? []).filter((id) => derived[id]),
      pulse: (step.pulse ?? []).filter((id) => derived[id]),
      camera,
      checkpoint: step.checkpoint,
    };
  });
}

/** Applies live control overrides to a step's state (control values win until the step changes). */
export function withOverrides(
  objects: DemoObject[],
  state: StepState,
  overrides: Record<string, Scalar>,
): Record<string, ObjectState> {
  if (Object.keys(overrides).length === 0) return state.objects;
  // Driven values (gates, wires, fed objects) recompute from the overridden inputs.
  const next = clone(state.objects);
  for (const [key, value] of Object.entries(overrides)) applyAssignment(next, key, value);
  deriveValues(objects, next);
  return next;
}

/** A step reference from the host: an id, or a 0-based index. -1 when unknown. */
export function resolveStepIndex(states: StepState[], step: string | number): number {
  if (typeof step === 'number') {
    return Number.isInteger(step) && step >= 0 && step < states.length ? step : -1;
  }
  return states.findIndex((s) => s.id === step);
}
