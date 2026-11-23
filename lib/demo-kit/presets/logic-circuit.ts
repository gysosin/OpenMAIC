/**
 * logic-circuit preset: one circuit drawn with gates and wires, walking its
 * whole truth table one row per step (the sr-latch walks set / hold / reset /
 * hold instead). Inputs are `set`; every gate and output value is derived by
 * the kit from the wires (core/timeline.ts deriveValues), so what the learner
 * sees is computed, not typed in. Toggles drive the inputs live.
 */
import type { LogicCircuit, LogicCircuitParams } from '@openmaic/generation';
import type { DemoObject, DemoSpec, GateKind, Vec3 } from '../core/types';
import { choices, framesToSpec, oneOf, record, type Frame } from './common';

export const CIRCUITS = [
  'not',
  'and',
  'or',
  'xor',
  'nand',
  'half-adder',
  'full-adder',
  '2-to-1-mux',
  'sr-latch',
] as const satisfies readonly LogicCircuit[];

interface Pin {
  id: string;
  label: string;
  at: Vec3;
  ask: string;
}
interface Circuit {
  title: string;
  inputs: Pin[];
  outputs: Pin[];
  gates: { id: string; gate: GateKind; at: Vec3; ask: string }[];
  /** [from, to]; wire ids are generated. */
  wires: [string, string][];
  /** Output values for one input row, used for captions only (the kit derives what is drawn). */
  out: (i: number[]) => number[];
  board: [number, number, number, number];
}

const pin = (id: string, label: string, at: Vec3, ask: string): Pin => ({ id, label, at, ask });
const GATE_ASK: Record<string, string> = {
  not: 'NOT gate: outputs the opposite of its input',
  and: 'AND gate: 1 only when both inputs are 1',
  or: 'OR gate: 1 when at least one input is 1',
  xor: 'XOR gate: 1 when exactly one input is 1',
  nand: 'NAND gate: 0 only when both inputs are 1',
  nor: 'NOR gate: 1 only when both inputs are 0',
};

function twoInput(
  kind: 'and' | 'or' | 'xor' | 'nand',
  f: (a: number, b: number) => number,
): Circuit {
  return {
    title: `${kind.toUpperCase()} gate`,
    inputs: [pin('a', 'A', [-3.4, 0.9, 0], 'Input A'), pin('b', 'B', [-3.4, -0.9, 0], 'Input B')],
    outputs: [pin('y', 'Y', [3.4, 0, 0], `Output Y = A ${kind.toUpperCase()} B`)],
    gates: [{ id: 'g', gate: kind, at: [0, 0, 0], ask: GATE_ASK[kind] }],
    wires: [
      ['a', 'g'],
      ['b', 'g'],
      ['g', 'y'],
    ],
    out: ([a, b]) => [f(a, b)],
    board: [-4.6, 4.6, -2.1, 2.1],
  };
}

const CIRCUIT: Record<LogicCircuit, () => Circuit> = {
  not: () => ({
    title: 'NOT gate',
    inputs: [pin('a', 'A', [-3, 0, 0], 'Input A')],
    outputs: [pin('y', 'Y', [3, 0, 0], 'Output Y = NOT A')],
    gates: [{ id: 'g', gate: 'not', at: [0, 0, 0], ask: GATE_ASK.not }],
    wires: [
      ['a', 'g'],
      ['g', 'y'],
    ],
    out: ([a]) => [1 - a],
    board: [-4.2, 4.2, -1.5, 1.5],
  }),
  and: () => twoInput('and', (a, b) => a & b),
  or: () => twoInput('or', (a, b) => a | b),
  xor: () => twoInput('xor', (a, b) => a ^ b),
  nand: () => twoInput('nand', (a, b) => 1 - (a & b)),
  'half-adder': () => ({
    title: 'Half adder',
    inputs: [
      pin('a', 'A', [-3.6, 1, 0], 'Input bit A'),
      pin('b', 'B', [-3.6, -1, 0], 'Input bit B'),
    ],
    outputs: [
      pin('sum', 'Sum', [3.6, 1, 0], 'Sum bit, the XOR of A and B'),
      pin('carry', 'Carry', [3.6, -1, 0], 'Carry bit, the AND of A and B'),
    ],
    gates: [
      { id: 'xor', gate: 'xor', at: [0, 1, 0], ask: GATE_ASK.xor },
      { id: 'and', gate: 'and', at: [0, -1, 0], ask: GATE_ASK.and },
    ],
    wires: [
      ['a', 'xor'],
      ['b', 'xor'],
      ['a', 'and'],
      ['b', 'and'],
      ['xor', 'sum'],
      ['and', 'carry'],
    ],
    out: ([a, b]) => [a ^ b, a & b],
    board: [-4.8, 4.8, -2.2, 2.2],
  }),
  'full-adder': () => ({
    title: 'Full adder',
    inputs: [
      pin('a', 'A', [-6, 2, 0], 'Input bit A'),
      pin('b', 'B', [-6, 0.6, 0], 'Input bit B'),
      pin('cin', 'Cin', [-2.6, -2.7, 0], 'Carry in, from the column to the right'),
    ],
    outputs: [
      pin('sum', 'Sum', [5.6, 1.2, 0], 'Sum = A XOR B XOR Cin'),
      pin('cout', 'Cout', [5.6, -1, 0], 'Carry out = (A AND B) OR (Cin AND (A XOR B))'),
    ],
    gates: [
      { id: 'x1', gate: 'xor', at: [-3, 1.5, 0], ask: 'XOR: A XOR B, the half sum' },
      { id: 'n1', gate: 'and', at: [-3, -0.4, 0], ask: 'AND: A AND B, a carry from A and B alone' },
      { id: 'x2', gate: 'xor', at: [0.7, 1.2, 0], ask: 'XOR: (A XOR B) XOR Cin, the sum bit' },
      {
        id: 'n2',
        gate: 'and',
        at: [0.7, -1.6, 0],
        ask: 'AND: Cin AND (A XOR B), a carry passed through',
      },
      { id: 'o1', gate: 'or', at: [3.2, -1, 0], ask: 'OR: either carry makes Cout' },
    ],
    wires: [
      ['a', 'x1'],
      ['b', 'x1'],
      ['a', 'n1'],
      ['b', 'n1'],
      ['x1', 'x2'],
      ['cin', 'x2'],
      ['x1', 'n2'],
      ['cin', 'n2'],
      ['n1', 'o1'],
      ['n2', 'o1'],
      ['x2', 'sum'],
      ['o1', 'cout'],
    ],
    out: ([a, b, c]) => [a ^ b ^ c, (a & b) | (c & (a ^ b))],
    board: [-7.2, 6.8, -3.6, 3],
  }),
  '2-to-1-mux': () => ({
    title: '2-to-1 multiplexer',
    inputs: [
      pin('a', 'A', [-5, 1.5, 0], 'Data input A, chosen when S = 0'),
      pin('b', 'B', [-5, -0.5, 0], 'Data input B, chosen when S = 1'),
      pin('s', 'S', [-5, -3, 0], 'Select input'),
    ],
    outputs: [pin('y', 'Y', [5.4, 0, 0], 'Output Y: A when S = 0, B when S = 1')],
    gates: [
      { id: 'inv', gate: 'not', at: [-2.4, -3, 0], ask: 'NOT S: enables the A path when S = 0' },
      { id: 'ga', gate: 'and', at: [0.2, 1.2, 0], ask: 'AND: passes A when S = 0' },
      { id: 'gb', gate: 'and', at: [0.2, -1.2, 0], ask: 'AND: passes B when S = 1' },
      { id: 'or', gate: 'or', at: [3, 0, 0], ask: 'OR: whichever path is enabled reaches Y' },
    ],
    wires: [
      ['a', 'ga'],
      ['inv', 'ga'],
      ['b', 'gb'],
      ['s', 'gb'],
      ['s', 'inv'],
      ['ga', 'or'],
      ['gb', 'or'],
      ['or', 'y'],
    ],
    // Inputs in table order A, B, S.
    out: ([a, b, s]) => [s ? b : a],
    board: [-6.2, 6.6, -4, 2.6],
  }),
  'sr-latch': () => ({
    title: 'SR latch (NOR)',
    inputs: [pin('r', 'R', [-4, 1.5, 0], 'Reset input'), pin('s', 'S', [-4, -1.5, 0], 'Set input')],
    outputs: [
      pin('q', 'Q', [4.2, 1.3, 0], 'Q, the stored bit'),
      pin('qn', 'Q̄', [4.2, -1.3, 0], 'Q̄, always the opposite of Q'),
    ],
    gates: [
      { id: 'top', gate: 'nor', at: [0, 1.3, 0], ask: 'NOR: Q = NOT (R OR Q̄)' },
      { id: 'bot', gate: 'nor', at: [0, -1.3, 0], ask: 'NOR: Q̄ = NOT (S OR Q)' },
    ],
    wires: [
      ['r', 'top'],
      ['bot', 'top'],
      ['s', 'bot'],
      ['top', 'bot'],
      ['top', 'q'],
      ['bot', 'qn'],
    ],
    out: () => [],
    board: [-5.2, 5.4, -2.7, 2.7],
  }),
};

/** NOR latch step: settles Q from S, R and the stored Q. */
export function latch(s: number, r: number, q: number): number {
  for (let i = 0; i < 4; i++) {
    const qn = 1 - (s | q);
    q = 1 - (r | qn);
  }
  return q;
}

export function logicCircuit(raw: LogicCircuitParams | Record<string, unknown> = {}): DemoSpec {
  const name = oneOf(record(raw).circuit, CIRCUITS, 'half-adder');
  const c = CIRCUIT[name]();
  const [x0, x1, y0, y1] = c.board;
  const wireId = ([from, to]: [string, string]) => `w-${from}-${to}`;
  const defs: DemoObject[] = [
    {
      id: 'board',
      type: 'plane',
      at: [(x0 + x1) / 2, (y0 + y1) / 2, -0.55],
      rotation: [90, 0, 0],
      size: [x1 - x0, 1, y1 - y0],
    },
    ...c.inputs.map(
      (p): DemoObject => ({
        id: p.id,
        type: 'cell',
        at: p.at,
        label: p.label,
        value: 0,
        ask: p.ask,
      }),
    ),
    ...c.gates.map(
      (g): DemoObject => ({ id: g.id, type: 'gate', gate: g.gate, at: g.at, ask: g.ask }),
    ),
    ...c.outputs.map(
      (p): DemoObject => ({ id: p.id, type: 'cell', at: p.at, label: p.label, ask: p.ask }),
    ),
    ...c.wires.map((w): DemoObject => ({ id: wireId(w), type: 'wire', from: w[0], to: w[1] })),
  ];
  const ins = c.inputs.map((p) => p.id);
  const controls = c.inputs.map((p) => ({
    id: `${p.id}-toggle`,
    type: 'toggle' as const,
    bind: `${p.id}.value`,
    label: p.label,
  }));
  const wiresFrom = (ids: string[]) => c.wires.filter(([from]) => ids.includes(from)).map(wireId);
  const frames: Frame[] = [];
  const row = (
    values: number[],
    extra: Partial<Frame> & { id: string },
    gates: Record<string, number> = {},
  ) => {
    const show: Frame['show'] = {};
    ins.forEach((id, i) => (show[id] = { value: values[i] }));
    // Gates keep their latched value as the starting point (sr-latch only).
    for (const [id, v] of Object.entries(gates)) show[id] = { value: v };
    frames.push({ ...extra, show });
  };
  const names = c.inputs.map((p) => p.label);
  const describe = (v: number[]) => v.map((b, i) => `${names[i]}=${b}`).join(', ');

  if (name === 'sr-latch') {
    // Gate values are set to the stored state before the input change; the kit settles them.
    const walk: [string, number, number, string][] = [
      ['reset', 0, 1, 'R = 1 resets the latch: Q = 0, Q̄ = 1'],
      ['hold-0', 0, 0, 'R back to 0: nothing changes, Q holds 0'],
      ['set', 1, 0, 'S = 1 sets the latch: Q turns to 1, Q̄ to 0'],
      ['hold-1', 0, 0, 'S back to 0, yet Q stays 1: the latch remembers'],
      ['reset-again', 0, 1, 'R = 1 again resets it: Q = 0'],
      ['hold-again', 0, 0, 'Both inputs 0: Q holds 0 until S or R is pulsed'],
    ];
    let q = 0;
    walk.forEach(([id, s, r, caption], i) => {
      const [, s0, r0] = i === 0 ? ['', 0, 0] : walk[i - 1];
      if (id === 'hold-1') {
        // Asked while S is still 1, before the answer is on screen.
        const quiz = choices(
          'It stays 1',
          ['It falls back to 0', 'It flickers between 0 and 1'],
          1,
        );
        row(
          [r0, s0],
          {
            id: 'hold-1-quiz',
            checkpoint: {
              question: 'S goes back to 0. What does Q do?',
              options: quiz.options,
              answer: quiz.answer,
            },
          },
          { top: q, bot: 1 - q },
        );
      }
      const before = q;
      q = latch(s, r, q);
      const changed = [r !== r0 ? 'r' : '', s !== s0 ? 's' : ''].filter(Boolean);
      row(
        [r, s],
        {
          id,
          caption,
          pulse: [...wiresFrom(changed), ...(before !== q ? wiresFrom(['top', 'bot']) : [])],
          highlight: ['q'],
          camera: 'overview',
        },
        { top: before, bot: 1 - before },
      );
    });
    return framesToSpec(c.title, defs, frames, controls);
  }

  // Truth table rows in counting order, first input as the most significant bit.
  const k = ins.length;
  const rows = Array.from({ length: 2 ** k }, (_, n) => ins.map((_, i) => (n >> (k - 1 - i)) & 1));
  const outNames = c.outputs.map((p) => p.label);
  rows.forEach((values, n) => {
    const outs = c.out(values);
    const result = outs.map((v, i) => `${outNames[i]} ${v}`).join(', ');
    if (n === rows.length - 1 && n > 0) {
      const target = c.outputs.length - 1;
      const quiz = choices(String(outs[target]), [String(1 - outs[target])], n);
      row(rows[n - 1], {
        id: 'quiz',
        checkpoint: {
          question: `Last row: ${describe(values)}. What is ${outNames[target]}?`,
          options: quiz.options,
          answer: quiz.answer,
        },
      });
    }
    const changed = n === 0 ? [] : ins.filter((_, i) => values[i] !== rows[n - 1][i]);
    row(values, {
      id: `row-${n + 1}`,
      caption: `Row ${n + 1} of ${rows.length}: ${describe(values)} → ${result}`,
      pulse: wiresFrom(changed),
      highlight: c.outputs.map((p) => p.id),
      camera: 'overview',
    });
  });
  return framesToSpec(c.title, defs, frames, controls);
}
