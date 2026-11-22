import { describe, expect, it } from 'vitest';

import { HALF_ADDER } from '@/app/sandbox-lab/demo-kit/fixtures';
import { stepAt } from '@/lib/demo-kit/core/motion';
import { buildStates, resolveStepIndex, withOverrides } from '@/lib/demo-kit/core/timeline';
import type { DemoSpec } from '@/lib/demo-kit/core/types';

const values = (spec: DemoSpec, ids: string[]) =>
  buildStates(spec).map((s) => Object.fromEntries(ids.map((id) => [id, s.objects[id].value])));

describe('buildStates', () => {
  it('derives the half adder truth table step by step', () => {
    expect(values(HALF_ADDER, ['a', 'b', 'sum', 'carry'])).toEqual([
      { a: 0, b: 0, sum: 0, carry: 0 },
      { a: 1, b: 0, sum: 1, carry: 0 },
      { a: 1, b: 0, sum: 1, carry: 0 },
      { a: 1, b: 1, sum: 0, carry: 1 },
      { a: 1, b: 1, sum: 0, carry: 1 },
    ]);
  });

  it('keeps persistent verbs and drops transient ones on later steps', () => {
    const spec: DemoSpec = {
      version: 1,
      kind: 'scene3d',
      objects: [
        { id: 'x', type: 'box', at: [0, 0, 0] },
        { id: 'y', type: 'sphere', hidden: true },
      ],
      steps: [
        { id: 'one', caption: 'start' },
        { id: 'two', move: { x: [1, 2, 3] }, show: ['y'], pulse: ['x'], highlight: ['y'], camera: 'x' },
        { id: 'three', hide: ['x'], set: { 'y.scale': 2, 'y.label': 'Y' } },
        { id: 'four', checkpoint: { question: 'Q?', options: ['a', 'b'], answer: 1 } },
      ],
    };
    const [one, two, three, four] = buildStates(spec);
    expect(one.objects.y.visible).toBe(false);
    expect(two.objects.x.at).toEqual([1, 2, 3]);
    expect(two.objects.y.visible).toBe(true);
    expect(two.pulse).toEqual(['x']);
    expect(two.highlight).toEqual(['y']);
    expect(three.objects.x).toMatchObject({ visible: false, at: [1, 2, 3] });
    expect(three.objects.y).toMatchObject({ visible: true, scale: 2, label: 'Y' });
    expect(three.pulse).toEqual([]);
    expect(three.highlight).toEqual([]);
    expect(three.camera).toBe('x');
    expect(four.caption).toBe('Q?');
    expect(four.checkpoint?.answer).toBe(1);
    // Earlier states are untouched by later steps, so going back is exact.
    expect(one.objects.x.at).toEqual([0, 0, 0]);
    expect(one.camera).toBe('overview');
  });

  it('ignores unknown objects, props and malformed moves', () => {
    const spec: DemoSpec = {
      version: 1,
      kind: 'scene3d',
      objects: [{ id: 'x', type: 'box', at: [0, 0, 0] }],
      steps: [
        {
          id: 's',
          set: { 'nope.value': 1, 'x.bogus': 3, noDot: 1, 'x.y': 'abc' },
          move: { x: [1, 2] as unknown as [number, number, number], ghost: [1, 1, 1] },
          pulse: ['ghost'],
        },
      ],
    };
    const [s] = buildStates(spec);
    expect(Object.keys(s.objects)).toEqual(['x']);
    expect(s.objects.x.at).toEqual([0, 0, 0]);
    expect(s.pulse).toEqual([]);
  });

  it('hides a wire whose endpoint is hidden', () => {
    const spec: DemoSpec = {
      version: 1,
      kind: 'scene3d',
      objects: [
        { id: 'a', type: 'cell', value: 1 },
        { id: 'b', type: 'cell', hidden: true },
        { id: 'w', type: 'wire', from: 'a', to: 'b' },
      ],
      steps: [{ id: 's1' }, { id: 's2', show: ['b'] }],
    };
    const [s1, s2] = buildStates(spec);
    expect(s1.objects.w.visible).toBe(false);
    expect(s2.objects.w.visible).toBe(true);
    expect(s2.objects.b.value).toBe(1);
  });

  it('gives a spec without steps one start step', () => {
    expect(buildStates({ objects: [] }).map((s) => s.id)).toEqual(['start']);
  });
});

describe('withOverrides', () => {
  it('re-derives driven values from a control override without touching the step', () => {
    const states = buildStates(HALF_ADDER);
    const live = withOverrides(HALF_ADDER.objects ?? [], states[0], { 'a.value': 1, 'b.value': 1 });
    expect([live.sum.value, live.carry.value]).toEqual([0, 1]);
    expect(states[0].objects.carry.value).toBe(0);
  });
});

describe('step lookup', () => {
  it('resolves ids and indices, and rejects unknown ones', () => {
    const states = buildStates(HALF_ADDER);
    expect(resolveStepIndex(states, 's4')).toBe(3);
    expect(resolveStepIndex(states, 2)).toBe(2);
    expect(resolveStepIndex(states, 'zz')).toBe(-1);
    expect(resolveStepIndex(states, 9)).toBe(-1);
    expect(resolveStepIndex(states, 1.5)).toBe(-1);
  });

  it('maps a scrub time to the nearest step, switching halfway', () => {
    const times = [0, 1, 2.4, 3.4];
    expect([0, 0.49, 0.5, 1.6, 1.7, 3.0, 9].map((t) => stepAt(times, t))).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });
});
