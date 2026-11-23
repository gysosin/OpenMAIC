import { describe, expect, test } from 'vitest';

import { validateDemoSpec } from '@openmaic/generation';
import { DEMO_FIXTURES } from '@/app/sandbox-lab/demo-kit/fixtures';

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

  test.each(Object.entries(DEMO_FIXTURES))('kit fixture %s validates with nothing dropped', (_n, spec) => {
    const r = validateDemoSpec(spec);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toEqual(spec);
  });

  test('rejects unsafe colours, parent cycles, huge heights grids and unknown set targets', () => {
    const raw = {
      version: 1,
      kind: 'scene3d',
      title: 't',
      objects: [
        { id: 'a', type: 'group', parent: 'b' },
        { id: 'b', type: 'group', parent: 'a' },
        { id: 'c', type: 'box', color: 'url(javascript:alert(1))' },
        { id: 's', type: 'surface', heights: Array.from({ length: 1000 }, () => Array(1000).fill(0)) },
      ],
      steps: [{ id: 's1', set: { 'ghost.value': 1, 'c.bogus': 1, 'c.color': 'red;x' } }],
    };
    const p = errPaths(raw);
    expect(p).toContain('objects.0.parent');
    expect(p).toContain('objects.1.parent');
    expect(p).toContain('objects.2.color');
    expect(p).toContain('objects.3.heights');
    expect(p).toContain('steps.0.set.ghost.value');
    expect(p).toContain('steps.0.set.c.bogus');
    expect(p).toContain('steps.0.set.c.color');
  });
});

describe('validateDemoSpec, kind "flow"', () => {
  const flow = () => ({
    version: 1,
    kind: 'flow',
    title: 'Pipeline',
    direction: 'right',
    objects: [
      { id: 'a', type: 'node', label: 'A', icon: 'server', shape: 'box' },
      { id: 'b', type: 'node', label: 'B', shape: 'pill' },
      { id: 'ab', type: 'edge', from: 'a', to: 'b', label: 'go' },
      { id: 't', type: 'token', from: 'a', label: 'req' },
    ],
    steps: [
      { id: 's1', highlight: ['a'] },
      { id: 's2', travel: { t: 'ab' }, set: { 't.label': 'resp', 'b.value': 42 } },
      { id: 's3', travel: { t: 'a' } },
    ],
  });

  test('accepts nodes, edges, tokens, travel and direction', () => {
    const r = validateDemoSpec(flow());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.steps[1].travel).toEqual({ t: 'ab' });
  });

  test('flow and scene3d types do not mix', () => {
    const raw = flow() as any;
    raw.objects.push({ id: 'cube', type: 'box' });
    expect(errPaths(raw)).toContain('objects.4.type');
    const scene = halfAdder() as any;
    scene.objects.push({ id: 'n', type: 'node' });
    expect(errPaths(scene)).toContain('objects.4.type');
  });

  test('edges join existing nodes; tokens start on a node', () => {
    const raw = flow() as any;
    raw.objects[2].to = 't';
    delete raw.objects[2].from;
    raw.objects[3].from = 'ab';
    const p = errPaths(raw);
    expect(p).toContain('objects.2.from');
    expect(p).toContain('objects.2.to');
    expect(p).toContain('objects.3.from');
  });

  test('travel moves tokens onto edges or nodes only', () => {
    const raw = flow() as any;
    raw.steps[1].travel = { a: 'ab', t: 't', ghost: 'ab' };
    const p = errPaths(raw);
    expect(p).toContain('steps.1.travel.a');
    expect(p).toContain('steps.1.travel.t');
    expect(p).toContain('steps.1.travel.ghost');
    const scene = halfAdder() as any;
    scene.steps[0].travel = { a: 'w1' };
    expect(errPaths(scene)).toContain('steps.0.travel.a');
  });

  test('rejects unknown icons, shapes and directions, an empty flow and an oversized one', () => {
    const raw = flow() as any;
    raw.objects[0].icon = 'skull';
    raw.objects[1].shape = 'hexagon';
    raw.direction = 'sideways';
    expect(errPaths(raw)).toEqual(expect.arrayContaining(['objects.0.icon', 'objects.1.shape', 'direction']));
    const empty = { ...flow(), objects: [{ id: 't', type: 'token' }] };
    expect(errPaths(empty)).toContain('objects');
    const big = flow() as any;
    for (let i = 0; i < 60; i++) big.objects.push({ id: `x${i}`, type: 'node' });
    expect(errPaths(big)).toContain('objects');
  });
});
