import { describe, expect, test } from 'vitest';

import { validateDemoSpec } from '@openmaic/generation';

const halfAdder = () => ({
  version: 1,
  kind: 'scene3d',
  title: 'Half adder',
  objects: [
    { id: 'a', type: 'box', at: [-2, 0, 0], label: 'A', ask: 'Input bit A' },
    { id: 'b', type: 'box', at: [-2, 0, 2], label: 'B' },
    { id: 'xor', type: 'gate', gate: 'xor', at: [0, 0.6, 0] },
    { id: 'w1', type: 'wire', from: 'a', to: 'xor' },
  ],
  steps: [
    { id: 's1', caption: 'Both inputs are 0', set: { 'a.value': 0, 'b.value': 0 } },
    { id: 's2', caption: 'Flip A to 1', set: { 'a.value': 1 }, pulse: ['w1'], camera: 'xor' },
    { id: 's3', checkpoint: { question: 'Carry bit now?', options: ['0', '1'], answer: 0 } },
  ],
  controls: [{ id: 'aToggle', type: 'toggle', bind: 'a.value' }],
});

const errPaths = (raw: unknown) => {
  const r = validateDemoSpec(raw);
  return r.ok ? [] : r.errors.map((e) => e.path);
};

describe('validateDemoSpec', () => {
  test('accepts the half-adder spec', () => {
    const r = validateDemoSpec(halfAdder());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.steps).toHaveLength(3);
  });

  test('drops unknown fields at every level', () => {
    const raw = halfAdder() as any;
    raw.evil = 1;
    raw.objects[0].onclick = 'x';
    raw.steps[0].script = 'y';
    const r = validateDemoSpec(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec).not.toHaveProperty('evil');
      expect(r.spec.objects[0]).not.toHaveProperty('onclick');
      expect(r.spec.steps[0]).not.toHaveProperty('script');
    }
  });

  test('bad primitive type gives a precise path', () => {
    const raw = halfAdder() as any;
    raw.objects[1].type = 'teapot';
    expect(errPaths(raw)).toContain('objects.1.type');
  });

  test('missing step id gives a precise path', () => {
    const raw = halfAdder() as any;
    delete raw.steps[1].id;
    expect(errPaths(raw)).toContain('steps.1.id');
  });

  test('duplicate step and object ids are rejected', () => {
    const raw = halfAdder() as any;
    raw.steps[1].id = 's1';
    raw.objects[1].id = 'a';
    const p = errPaths(raw);
    expect(p).toContain('steps.1.id');
    expect(p).toContain('objects.1.id');
  });

  test('checkpoint answer out of range', () => {
    const raw = halfAdder() as any;
    raw.steps[2].checkpoint.answer = 2;
    expect(errPaths(raw)).toContain('steps.2.checkpoint.answer');
  });

  test('references to unknown objects are rejected', () => {
    const raw = halfAdder() as any;
    raw.objects[3].to = 'nope';
    raw.steps[1].pulse = ['ghost'];
    raw.steps[0].set = { 'zzz.value': 1 };
    raw.controls[0].bind = 'q.value';
    const p = errPaths(raw);
    expect(p).toContain('objects.3.to');
    expect(p).toContain('steps.1.pulse.0');
    expect(p).toContain('steps.0.set.zzz.value');
    expect(p).toContain('controls.0.bind');
  });

  test('preset kind requires preset name; wrong version and non-objects rejected', () => {
    expect(errPaths({ version: 1, kind: 'preset', title: 't' })).toContain('preset');
    expect(errPaths({ ...halfAdder(), version: 2 })).toContain('version');
    expect(validateDemoSpec('nope').ok).toBe(false);
    expect(validateDemoSpec(null).ok).toBe(false);
  });

  test('valid preset spec needs no objects or steps', () => {
    const r = validateDemoSpec({
      version: 1,
      kind: 'preset',
      preset: 'logic-circuit',
      params: { circuit: 'half-adder' },
      title: 'Half adder',
    });
    expect(r.ok).toBe(true);
  });
});
