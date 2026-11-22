/**
 * The gsap timeline: one label per step (`s0`, `s1`, ...) and, between
 * neighbouring labels, fromTo tweens from step i-1's state to step i's. Because
 * every tween states both ends, `tweenTo(label)` plays forward, backward and
 * across many steps, and a scrub (`progress()`) lands on a consistent picture.
 *
 * Logic changes cascade: a value change starts at the inputs and reaches each
 * gate a beat later (by wire depth), with a bead travelling along pulsed wires,
 * so a learner sees the signal move instead of everything switching at once.
 */
import gsap from 'gsap';
import * as THREE from 'three';
import type { Anim, Built } from './primitives';
import { bodyColor } from './primitives';
import type { ObjectState, StepState } from './timeline';
import type { Theme } from './theme';
import type { DemoObject } from './types';

const tmp = new THREE.Color();
const rgb = { r: 0, g: 0, b: 0 };

export function animTarget(
  built: Built,
  state: ObjectState,
  theme: Theme,
  highlighted: boolean,
): Omit<Anim, 'bump'> {
  tmp.set(bodyColor(built.object, state, theme)).getRGB(rgb, THREE.SRGBColorSpace);
  return {
    x: state.at[0],
    y: state.at[1],
    z: state.at[2],
    scale: state.scale,
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    presence: state.visible ? 1 : 0,
    glow: highlighted ? 1 : 0,
  };
}

/** Signal depth per object: inputs 0, each wire or gate one more than what feeds it. */
export function logicDepth(objects: DemoObject[]): Map<string, number> {
  const depth = new Map<string, number>();
  const wires = objects.filter((o) => o.type === 'wire');
  for (let round = 0; round <= objects.length; round++) {
    let changed = false;
    for (const wire of wires) {
      const from = typeof wire.from === 'string' ? (depth.get(wire.from) ?? 0) : 0;
      if (depth.get(wire.id) !== from + 1) {
        depth.set(wire.id, from + 1);
        changed = true;
      }
    }
    for (const object of objects) {
      if (object.type === 'wire') continue;
      const feeds = wires.filter((w) => w.to === object.id).map((w) => depth.get(w.id) ?? 1);
      const d = feeds.length ? Math.max(...feeds) : 0;
      if ((depth.get(object.id) ?? 0) !== d) {
        depth.set(object.id, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

const BEAT = 0.2;

export interface BuiltTimeline {
  timeline: gsap.core.Timeline;
  /** Label time of each step. */
  times: number[];
}

export function setAnims(builts: Map<string, Built>, state: StepState, theme: Theme): void {
  for (const [id, built] of builts) {
    const os = state.objects[id];
    if (!os) continue;
    Object.assign(built.anim, animTarget(built, os, theme, state.highlight.includes(id)), { bump: 0 });
  }
}

export function buildTimeline(
  builts: Map<string, Built>,
  objects: DemoObject[],
  states: StepState[],
  theme: Theme,
  onUpdate: () => void,
): BuiltTimeline {
  const timeline = gsap.timeline({ paused: true, onUpdate });
  const depth = logicDepth(objects);
  const times = [0];
  timeline.addLabel('s0', 0);
  for (let i = 1; i < states.length; i++) {
    const start = times[i - 1];
    let end = start + 0.9;
    const prev = states[i - 1];
    const cur = states[i];
    const at = (offset: number, duration: number) => {
      end = Math.max(end, start + offset + duration);
      return start + offset;
    };
    for (const [id, built] of builts) {
      const a = prev.objects[id];
      const b = cur.objects[id];
      if (!a || !b) continue;
      const from = animTarget(built, a, theme, prev.highlight.includes(id));
      const to = animTarget(built, b, theme, cur.highlight.includes(id));
      const d = depth.get(id) ?? 0;
      const anim = built.anim;
      const tween = (
        keys: Array<keyof Anim>,
        offset: number,
        duration: number,
        ease: string,
      ) => {
        if (keys.every((k) => from[k as keyof typeof from] === to[k as keyof typeof to])) return;
        const f: Record<string, number> = {};
        const t: Record<string, number> = {};
        for (const k of keys) {
          f[k] = from[k as keyof typeof from];
          t[k] = to[k as keyof typeof to];
        }
        timeline.fromTo(anim, f, { ...t, duration, ease, immediateRender: false }, at(offset, duration));
      };
      tween(['x', 'y', 'z', 'scale'], 0.05, 0.9, 'power3.inOut');
      tween(['presence'], b.visible ? 0.1 : 0, b.visible ? 0.65 : 0.4, b.visible ? 'power2.out' : 'power2.in');
      tween(['r', 'g', 'b'], 0.12 + BEAT * d, 0.45, 'power2.out');
      tween(['glow'], 0.15, 0.5, 'power2.inOut');
      if (cur.pulse.includes(id)) {
        const wire = built.object.type === 'wire';
        const offset = wire ? 0.05 + BEAT * Math.max(d - 1, 0) : 0.2;
        const duration = wire ? 0.55 : 0.7;
        timeline.fromTo(
          anim,
          { bump: 0 },
          { bump: 1, duration, ease: wire ? 'power1.inOut' : 'power2.out', immediateRender: false },
          at(offset, duration),
        );
      }
    }
    times.push(end);
    timeline.addLabel(`s${i}`, end);
  }
  // Pad so the last label is reachable and progress() spans every step.
  if (timeline.duration() < times[times.length - 1]) timeline.set({}, {}, times[times.length - 1]);
  return { timeline, times };
}

/** The step a playhead time shows: the nearest label, switching halfway. */
export function stepAt(times: number[], time: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (time >= (times[i - 1] + times[i]) / 2) best = i;
  }
  return best;
}
