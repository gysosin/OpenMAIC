/**
 * Presets batch 1 (story 3.4): every expansion is a valid DemoSpec, and the
 * states the kit derives from it (core/timeline.ts buildStates) teach the
 * right thing: truth tables, two's complement values, pointer targets, stack
 * direction, BST shapes and hash chains.
 */
import { describe, expect, it } from 'vitest';

import { PRESET_PARAMS, validateDemoSpec } from '@openmaic/generation';
import { buildStates, withOverrides, type StepState } from '@/lib/demo-kit/core/timeline';
import type { DemoSpec, Vec3 } from '@/lib/demo-kit/core/types';
import { bitRegister } from '@/lib/demo-kit/presets/bit-register';
import { dataStructure, hashOf } from '@/lib/demo-kit/presets/data-structure';
import { expandPreset, PRESETS } from '@/lib/demo-kit/presets';
import { logicCircuit } from '@/lib/demo-kit/presets/logic-circuit';
import { memoryGrid } from '@/lib/demo-kit/presets/memory-grid';

const states = (spec: DemoSpec) => new Map(buildStates(spec).map((s) => [s.id, s]));
/** A cell's value as text, without the word joiner that keeps 0 and 1 from being drawn as bits. */
const text = (s: StepState, id: string) => String(s.objects[id]?.value ?? '').replace(/⁠/g, '');
const bit = (s: StepState, id: string) => Number(s.objects[id].value);
const visible = (s: StepState, id: string) => s.objects[id]?.visible === true;

const VARIANTS: [string, Record<string, unknown>][] = [
  ...[1, 4, 8, 16].flatMap((bits) =>
    ['counting', 'twos-complement', 'byte-groups', 'powers-of-two'].map(
      (mode): [string, Record<string, unknown>] => ['bit-register', { bits, mode }],
    ),
  ),
  ['bit-register', { bits: 8, mode: 'twos-complement', values: [3, -3, -128, 127, -1] }],
  ...['not', 'and', 'or', 'xor', 'nand', 'half-adder', 'full-adder', '2-to-1-mux', 'sr-latch'].map(
    (circuit): [string, Record<string, unknown>] => ['logic-circuit', { circuit }],
  ),
  ['memory-grid', {}],
  ['memory-grid', { cells: 64, wordSize: 8, base: 0x7f00 }],
  [
    'memory-grid',
    { cells: 8, ops: Array.from({ length: 12 }, (_, i) => ({ op: 'push', value: i })) },
  ],
  ...['array', 'linked-list', 'stack', 'queue', 'binary-tree', 'hash-table'].map(
    (structure): [string, Record<string, unknown>] => ['data-structure', { structure }],
  ),
  [
    'data-structure',
    { structure: 'binary-tree', values: [5, 3, 8], ops: [{ op: 'traverse', order: 'level' }] },
  ],
  [
    'data-structure',
    {
      structure: 'hash-table',
      values: ['cat', 'dog', 'emu'],
      buckets: 3,
      ops: [{ op: 'search', value: 'dog' }],
    },
  ],
  [
    'data-structure',
    { structure: 'stack', values: [1], ops: [{ op: 'delete' }, { op: 'delete' }] },
  ],
];

describe('every preset expansion', () => {
  it.each(VARIANTS)('%s %j is a valid DemoSpec with a checkpoint-safe shape', (name, params) => {
    const spec = PRESETS[name as keyof typeof PRESETS](params);
    const result = validateDemoSpec(spec);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(spec.kind).toBe('scene3d');
    expect(spec.steps!.length).toBeGreaterThan(1);
  });

  it('survives garbage params by falling back to defaults', () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      for (const junk of [
        { bits: 99, mode: 'x', values: 'no' },
        { circuit: 7 },
        { cells: -1, ops: [{ op: 'nope' }, null] },
        { structure: 'graph', ops: [{}] },
      ]) {
        const result = validateDemoSpec(PRESETS[name](junk as Record<string, unknown>));
        expect(result.ok, `${name} ${JSON.stringify(junk)}`).toBe(true);
      }
    }
  });

  it('uses the same defaults as the generation-side zod schemas', () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const parsed = PRESET_PARAMS[name].parse({}) as Record<string, unknown>;
      expect(PRESETS[name](parsed)).toEqual(PRESETS[name]({}));
    }
  });

  it('expands kind "preset" specs, keeping their own title', () => {
    const spec = expandPreset({
      version: 1,
      kind: 'preset',
      preset: 'logic-circuit',
      params: { circuit: 'xor' },
      title: 'XOR',
    });
    expect(spec?.title).toBe('XOR');
    expect(spec?.objects?.some((o) => o.type === 'gate' && o.gate === 'xor')).toBe(true);
    expect(expandPreset({ version: 1, kind: 'preset', preset: 'toString', title: '' })).toBeNull();
    expect(expandPreset({ version: 1, kind: 'preset', preset: 'nope', title: '' })).toBeNull();
  });

  it('the generation schemas reject what the kit would drop', () => {
    expect(
      PRESET_PARAMS['bit-register'].safeParse({ bits: 8, mode: 'counting', values: [256] }).success,
    ).toBe(false);
    expect(
      PRESET_PARAMS['bit-register'].safeParse({
        bits: 8,
        mode: 'twos-complement',
        values: [-128, 127],
      }).success,
    ).toBe(true);
    expect(
      PRESET_PARAMS['memory-grid'].safeParse({
        cells: 8,
        ops: [{ op: 'store', cell: 8, value: 1 }],
      }).success,
    ).toBe(false);
    expect(PRESET_PARAMS['data-structure'].safeParse({ structure: 'graph' }).success).toBe(false);
  });
});

// ---------- bit-register ----------

describe('bit-register', () => {
  const bitsAt = (s: StepState, n: number) =>
    Array.from({ length: n }, (_, i) => bit(s, `b${n - 1 - i}`)).join('');

  it('keeps the readout equal to the bits on every step of every mode', () => {
    for (const bits of [1, 3, 8, 12, 16]) {
      for (const mode of ['counting', 'twos-complement', 'byte-groups', 'powers-of-two']) {
        for (const s of states(bitRegister({ bits, mode })).values()) {
          const pattern = bitsAt(s, bits);
          const unsigned = parseInt(pattern, 2);
          const signed =
            mode === 'twos-complement' && pattern[0] === '1' ? unsigned - 2 ** bits : unsigned;
          const label = s.objects.readout.label!;
          const [bin, dec, hex] = label.split(' = ');
          expect(bin.replace(/ /g, '')).toBe(pattern);
          if (dec !== '?') {
            expect(Number(dec.replace('−', '-'))).toBe(signed);
            expect(parseInt(hex, 16)).toBe(unsigned);
          }
        }
      }
    }
  });

  it("shows 8-bit two's complement values correctly, with the invert-and-add-one walk", () => {
    const s = states(bitRegister({ bits: 8, mode: 'twos-complement' }));
    const read = (id: string) => s.get(id)!.objects.readout.label;
    expect([...s.keys()]).toEqual(['v1', 'v2', 'v3-invert', 'v3', 'v4-quiz', 'v4', 'v5', 'v6']);
    expect(read('v2')).toBe('0000 0101 = 5 = 0x05');
    expect(read('v3-invert')).toBe('1111 1010 = −6 = 0xFA');
    expect(read('v3')).toBe('1111 1011 = −5 = 0xFB');
    expect(read('v4')).toBe('1111 1111 = −1 = 0xFF');
    expect(read('v5')).toBe('0111 1111 = 127 = 0x7F');
    expect(read('v6')).toBe('1000 0000 = −128 = 0x80');
    expect(s.get('v4-quiz')!.checkpoint!.options[s.get('v4-quiz')!.checkpoint!.answer]).toBe('−1');
    expect(s.get('v1')!.objects.b7.label).toBe('−2⁷');
  });

  it('counts with carries and lifts the bits that are on', () => {
    const s = states(bitRegister({ bits: 4 }));
    expect(s.get('v9')!.objects.readout.label).toBe('1000 = 8 = 0x8');
    expect(s.get('v9')!.caption).toContain('bits 0–2 roll over');
    expect(s.get('v9')!.pulse.sort()).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(s.get('v9')!.objects.b3.at[1]).toBeGreaterThan(0);
    expect(s.get('v9')!.objects.b0.at[1]).toBe(0);
  });

  it('reads each nibble as a hex digit in byte-groups mode', () => {
    const s = states(bitRegister({ bits: 16, mode: 'byte-groups', values: [0xbeef, 0x1234] }));
    const digits = (id: string) =>
      [3, 2, 1, 0].map((j) => s.get(id)!.objects[`h${j}`].label).join('');
    expect(digits('v1')).toBe('BEEF');
    expect(digits('v2')).toBe('1234');
    expect(s.get('v2')!.objects.readout.label).toBe('0001 0010 0011 0100 = 4660 = 0x1234');
  });

  it('drops values that do not fit', () => {
    const spec = bitRegister({ bits: 4, values: [3, 16, -1, 9] });
    expect(spec.steps!.map((st) => st.id)).toEqual(['v1', 'v2-quiz', 'v2']);
  });
});

// ---------- logic-circuit ----------

const TABLES: Record<string, { inputs: string[]; outputs: string[]; rows: number[][] }> = {
  not: {
    inputs: ['a'],
    outputs: ['y'],
    rows: [
      [0, 1],
      [1, 0],
    ],
  },
  and: {
    inputs: ['a', 'b'],
    outputs: ['y'],
    rows: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ],
  },
  or: {
    inputs: ['a', 'b'],
    outputs: ['y'],
    rows: [
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ],
  },
  xor: {
    inputs: ['a', 'b'],
    outputs: ['y'],
    rows: [
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ],
  },
  nand: {
    inputs: ['a', 'b'],
    outputs: ['y'],
    rows: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ],
  },
  'half-adder': {
    inputs: ['a', 'b'],
    outputs: ['sum', 'carry'],
    rows: [
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [1, 0, 1, 0],
      [1, 1, 0, 1],
    ],
  },
  'full-adder': {
    inputs: ['a', 'b', 'cin'],
    outputs: ['sum', 'cout'],
    rows: [
      [0, 0, 0, 0, 0],
      [0, 0, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 0, 1],
      [1, 0, 0, 1, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ],
  },
  '2-to-1-mux': {
    inputs: ['a', 'b', 's'],
    outputs: ['y'],
    rows: [
      [0, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 1],
      [1, 0, 0, 1],
      [1, 0, 1, 0],
      [1, 1, 0, 1],
      [1, 1, 1, 1],
    ],
  },
};

describe('logic-circuit', () => {
  it.each(Object.keys(TABLES))(
    '%s walks its full truth table and the derived outputs match it',
    (circuit) => {
      const { inputs, outputs, rows } = TABLES[circuit];
      const spec = logicCircuit({ circuit });
      const all = buildStates(spec);
      const walked = all.filter((s) => s.id.startsWith('row-'));
      expect(walked.map((s) => [...inputs, ...outputs].map((id) => bit(s, id)))).toEqual(rows);
      // The caption states the same outputs.
      walked.forEach((s, i) => expect(s.caption).toContain(`Row ${i + 1} of ${rows.length}`));
      // The checkpoint's answer is the last row's last output, and it comes before that row.
      const quiz = all.find((s) => s.checkpoint)!;
      expect(quiz.index).toBe(walked[walked.length - 1].index - 1);
      expect(Number(quiz.checkpoint!.options[quiz.checkpoint!.answer])).toBe(
        rows[rows.length - 1].at(-1),
      );
      // Toggles drive the same logic live.
      for (const row of rows) {
        const overrides = Object.fromEntries(inputs.map((id, i) => [`${id}.value`, row[i]]));
        const live = withOverrides(spec.objects!, all[0], overrides);
        expect(outputs.map((id) => Number(live[id].value))).toEqual(row.slice(inputs.length));
      }
    },
  );

  it('sr-latch sets, holds, resets and holds, with Q̄ the complement of Q', () => {
    const spec = logicCircuit({ circuit: 'sr-latch' });
    const s = states(spec);
    const walk = ['reset', 'hold-0', 'set', 'hold-1', 'reset-again', 'hold-again'];
    expect(
      walk.map((id) => [bit(s.get(id)!, 's'), bit(s.get(id)!, 'r'), bit(s.get(id)!, 'q')]),
    ).toEqual([
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    for (const id of walk) expect(bit(s.get(id)!, 'qn')).toBe(1 - bit(s.get(id)!, 'q'));
    const quiz = s.get('hold-1-quiz')!;
    expect([bit(quiz, 's'), bit(quiz, 'q')]).toEqual([1, 1]);
    expect(quiz.checkpoint!.options[quiz.checkpoint!.answer]).toBe('It stays 1');
    // Live: pulse R while Q holds 1.
    const live = withOverrides(spec.objects!, s.get('hold-1')!, { 'r.value': 1 });
    expect([Number(live.q.value), Number(live.qn.value)]).toEqual([0, 1]);
  });
});

// ---------- memory-grid ----------

describe('memory-grid', () => {
  const spec = memoryGrid();
  const s = states(spec);
  const object = (id: string) => spec.objects!.find((o) => o.id === id)!;

  it('stores values and draws the pointer to the cell whose address it holds', () => {
    const p = s.get('op3-pointer')!;
    expect(text(p, 'm0')).toBe('42');
    expect(text(p, 'm2')).toBe('0x100');
    expect(p.objects.m2.label).toBe('p  0x108');
    expect(visible(p, 'ptr-2-0')).toBe(true);
    const arrow = object('ptr-2-0');
    const target = object('m0').at!;
    const tip = arrow.to as Vec3;
    // The head stops at the target's edge, pointing at it.
    expect(Math.hypot(tip[0] - target[0], tip[1] - target[1])).toBeLessThan(0.8);
    const tail = arrow.from as Vec3;
    expect(Math.hypot(tail[0] - target[0], tail[1] - target[1])).toBeGreaterThan(
      Math.hypot(tip[0] - target[0], tip[1] - target[1]),
    );
    expect(text(s.get('op4-load')!, 'r0')).toBe('42');
  });

  it('grows the stack toward lower addresses and pops without erasing', () => {
    const sp = (id: string) => parseInt(text(s.get(id)!, 'spreg'), 16);
    expect(sp('memory')).toBe(0x140);
    expect(sp('op5-frame')).toBe(0x138);
    expect([text(s.get('op5-frame')!, 'm15'), text(s.get('op5-frame')!, 'm14')]).toEqual([
      '0x424',
      '?',
    ]);
    expect(sp('op6-push')).toBe(0x134);
    expect(text(s.get('op6-push')!, 'm13')).toBe('3');
    expect(sp('op7-push')).toBe(0x130);
    expect(text(s.get('op8-pop')!, 'r0')).toBe('5');
    expect(sp('op8-pop')).toBe(0x134);
    expect(text(s.get('op8-pop')!, 'm12')).toBe('5');
    expect(visible(s.get('op8-pop')!, 'pl12')).toBe(false);
    expect(sp('op9-return')).toBe(0x140);
    // The SP badge sits on the top-of-stack cell.
    const top = s.get('op7-push')!;
    expect(top.objects.sp.at[0]).toBeCloseTo(top.objects.m12.at[0] + 0.62);
    expect(top.objects.sp.at[1]).toBeCloseTo(top.objects.m12.at[1] + 0.42);
    const quiz = s.get('stack-quiz')!.checkpoint!;
    expect(quiz.options[quiz.answer]).toBe('Toward lower addresses');
  });

  it('stops at a stack overflow instead of clobbering data', () => {
    const ops = [
      { op: 'store', cell: 2, value: 9, name: 'x' },
      ...Array.from({ length: 8 }, (_, i) => ({ op: 'push', value: i + 10 })),
    ];
    const all = buildStates(memoryGrid({ cells: 8, wordSize: 1, base: 0, ops }));
    const last = all[all.length - 1];
    expect(text(last, 'm2')).toBe('9');
    expect(text(last, 'spreg')).toBe('0x003');
    expect(last.caption).toContain('overflow');
  });

  it('keeps 0 and 1 from being drawn as logic bits', () => {
    const last = buildStates(memoryGrid({ ops: [{ op: 'store', cell: 0, value: 1 }] })).at(-1)!;
    expect(last.objects.m0.value).toBe('⁠1');
  });
});

// ---------- data-structure ----------

/** Visible arrows of a step as value pairs, e.g. "3→8", "head→3". */
function links(spec: DemoSpec, s: StepState): string[] {
  const name = (id: string) => (/^n\d+$/.test(id) ? text(s, id) : /^bk\d+$/.test(id) ? id : id);
  return spec
    .objects!.filter((o) => o.type === 'arrow' && visible(s, o.id))
    .map((o) => `${name(o.from as string)}→${name(o.to as string)}`)
    .sort();
}
/** Visible node values of a step, ordered left to right. */
function row(s: StepState): string[] {
  return Object.entries(s.objects)
    .filter(([id, o]) => /^n\d+$/.test(id) && o.visible)
    .sort(([, a], [, b]) => a.at[0] - b.at[0] || b.at[1] - a.at[1])
    .map(([id]) => text(s, id));
}

describe('data-structure', () => {
  it('binary-tree: BST inserts, two-child delete via the in-order successor, sorted in-order walk', () => {
    const spec = dataStructure({ structure: 'binary-tree' });
    const s = states(spec);
    expect(links(spec, s.get('start')!)).toEqual(
      ['10→14', '3→1', '3→6', '6→4', '6→7', '8→10', '8→3'].sort(),
    );
    expect(s.get('insert-5-path')!.caption).toBe(
      '5 < 8: go left, 5 > 3: go right, 5 < 6: go left, 5 > 4: go right: an empty spot',
    );
    expect(links(spec, s.get('insert-5')!)).toContain('4→5');
    expect(
      ['search-7-1', 'search-7-2', 'search-7-3', 'search-7-4'].map((id) => s.get(id)!.caption),
    ).toEqual([
      '7 < 8: go left',
      '7 > 3: go right',
      '7 > 6: go right',
      '7 = 7: found after 4 comparisons',
    ]);
    expect(s.get('delete-3-successor')!.caption).toContain(
      'its in-order successor is the smallest key on its right, 4',
    );
    expect(links(spec, s.get('delete-3')!)).toEqual(
      ['10→14', '4→1', '4→6', '6→5', '6→7', '8→10', '8→4'].sort(),
    );
    expect(row(s.get('delete-3')!)).toEqual(['1', '4', '5', '6', '7', '8', '10', '14']);
    const last = [...s.values()].at(-1)!;
    expect(last.objects.out.label).toBe('In-order: 1 4 5 6 7 8 10 14');
    // Children sit below their parent, left keys left of it, right keys right of it.
    for (const step of s.values()) {
      if (new Set(row(step)).size !== row(step).length) continue; // the copy step shows the key twice
      for (const pair of links(spec, step)) {
        const [a, b] = pair.split('→');
        const at = (v: string) =>
          Object.entries(step.objects).find(
            ([id, o]) => /^n\d+$/.test(id) && o.visible && text(step, id) === v,
          )![1].at;
        expect(at(b)[1]).toBeLessThan(at(a)[1]);
        expect(Math.sign(at(b)[0] - at(a)[0])).toBe(Math.sign(Number(b) - Number(a)));
      }
    }
  });

  it('hash-table: keys chain in bucket h(k) = k mod m, collisions included', () => {
    const spec = dataStructure({ structure: 'hash-table' });
    const s = states(spec);
    expect(links(spec, s.get('start')!)).toEqual(
      ['12→5', 'bk0→7', 'bk1→22', 'bk3→17', 'bk5→12'].sort(),
    );
    expect(s.get('insert-19-hash')!.caption).toBe('h(19) = 19 mod 7 = 5: go to bucket 5');
    expect(s.get('insert-19')!.caption).toContain('Collision: bucket 5 already holds 12, 5');
    expect(links(spec, s.get('insert-19')!)).toEqual(
      ['12→5', '5→19', 'bk0→7', 'bk1→22', 'bk3→17', 'bk5→12'].sort(),
    );
    expect(links(spec, s.get('delete-12')!)).toEqual(
      ['5→19', 'bk0→7', 'bk1→22', 'bk3→17', 'bk5→5'].sort(),
    );
    expect(s.get('search-9-hash')!.caption).toBe(
      'h(9) = 9 mod 7 = 2: go to bucket 2, which is empty, so 9 is not stored',
    );
    const quiz = s.get('quiz')!.checkpoint!;
    expect(quiz.options[quiz.answer]).toBe('5');
    expect(hashOf('cat', 7)).toEqual({ code: 312, bucket: 312 % 7 });
    expect(hashOf(-3, 7).bucket).toBe(4);
  });

  it('linked-list: the new node points ahead before its predecessor is rewired, and delete bypasses first', () => {
    const spec = dataStructure({ structure: 'linked-list' });
    const s = states(spec);
    expect(links(spec, s.get('start')!)).toEqual(['3→8', '5→nil', '8→5', 'head→3'].sort());
    expect(links(spec, s.get('insert-4-new')!)).toEqual(
      ['3→8', '4→8', '5→nil', '8→5', 'head→3'].sort(),
    );
    expect(links(spec, s.get('insert-4')!)).toEqual(
      ['3→4', '4→8', '5→nil', '8→5', 'head→3'].sort(),
    );
    expect(row(s.get('insert-4')!)).toEqual(['3', '4', '8', '5']);
    expect(links(spec, s.get('delete-8-bypass')!)).toEqual(
      ['3→4', '4→5', '5→nil', '8→5', 'head→3'].sort(),
    );
    expect(links(spec, s.get('delete-8')!)).toEqual(['3→4', '4→5', '5→nil', 'head→3'].sort());
    expect(links(spec, s.get('insert-1')!)).toEqual(
      ['1→3', '3→4', '4→5', '5→nil', 'head→1'].sort(),
    );
    // Asked before searching for 5 in 3 → 4 → 8 → 5.
    const quiz = s.get('quiz')!.checkpoint!;
    expect(quiz.options[quiz.answer]).toBe('4');
  });

  it('array: shifts right before an insert and left after a delete', () => {
    const s = states(dataStructure({ structure: 'array' }));
    const shift = s.get('insert-9-shift')!;
    expect(['n1', 'n2', 'n3'].map((id) => shift.objects[id].label)).toEqual(['[2]', '[3]', '[4]']);
    expect(row(s.get('insert-9')!)).toEqual(['5', '9', '12', '7', '3']);
    expect(row(s.get('delete-12-done')!)).toEqual(['5', '9', '7', '3']);
    expect(s.get('quiz')!.checkpoint!.options[s.get('quiz')!.checkpoint!.answer]).toBe('3');
    expect(s.get('search-3-5')!.caption).toContain('found after 5 comparisons');
  });

  it('stack pops the newest item, queue dequeues the oldest', () => {
    const stack = states(dataStructure({ structure: 'stack' }));
    expect(stack.get('delete-2-done')!.objects.out.label).toBe('pop → 2');
    expect(stack.get('delete-7-done')!.objects.out.label).toBe('pop → 7');
    expect(stack.get('quiz')!.checkpoint!.options[stack.get('quiz')!.checkpoint!.answer]).toBe('2');
    const queue = states(dataStructure({ structure: 'queue' }));
    expect(queue.get('delete-4-done')!.objects.out.label).toBe('dequeue → 4');
    expect(queue.get('delete-9-done')!.objects.out.label).toBe('dequeue → 9');
    expect(row(queue.get('delete-9-done')!)).toEqual(['7', '2']);
  });
});
