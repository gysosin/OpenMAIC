/**
 * Hand-written DemoSpec fixtures for the demo kit (story 3.2): the C3 half
 * adder and an 8-bit register counting powers of two. Used by the sandbox lab
 * page and e2e/tests/demo-kit.spec.ts.
 */
import type { DemoSpec } from '@/lib/demo-kit/core/types';

export const HALF_ADDER: DemoSpec = {
  version: 1,
  kind: 'scene3d',
  title: 'Half adder',
  objects: [
    { id: 'board', type: 'plane', at: [0, 0, -0.55], rotation: [90, 0, 0], size: [10.4, 1, 4.6] },
    { id: 'a', type: 'cell', at: [-3.6, 1, 0], label: 'A', value: 0, ask: 'Input bit A' },
    { id: 'b', type: 'cell', at: [-3.6, -1, 0], label: 'B', value: 0, ask: 'Input bit B' },
    { id: 'xor', type: 'gate', gate: 'xor', at: [0, 1, 0], ask: 'XOR gate: 1 when exactly one input is 1' },
    { id: 'and', type: 'gate', gate: 'and', at: [0, -1, 0], ask: 'AND gate: 1 only when both inputs are 1' },
    { id: 'sum', type: 'cell', at: [3.6, 1, 0], label: 'Sum', ask: 'Sum bit, the XOR of A and B' },
    { id: 'carry', type: 'cell', at: [3.6, -1, 0], label: 'Carry', ask: 'Carry bit, the AND of A and B' },
    { id: 'wa1', type: 'wire', from: 'a', to: 'xor' },
    { id: 'wa2', type: 'wire', from: 'a', to: 'and' },
    { id: 'wb1', type: 'wire', from: 'b', to: 'xor' },
    { id: 'wb2', type: 'wire', from: 'b', to: 'and' },
    { id: 'ws', type: 'wire', from: 'xor', to: 'sum' },
    { id: 'wc', type: 'wire', from: 'and', to: 'carry' },
  ],
  steps: [
    { id: 's1', caption: 'Both inputs are 0, so sum and carry are 0', set: { 'a.value': 0, 'b.value': 0 } },
    {
      id: 's2',
      caption: 'Flip A to 1: the XOR gate sees exactly one 1',
      set: { 'a.value': 1 },
      pulse: ['wa1', 'wa2', 'ws'],
      highlight: ['xor'],
    },
    {
      id: 's3',
      checkpoint: { question: 'What is the carry bit now?', options: ['0', '1'], answer: 0 },
      highlight: ['and'],
    },
    {
      id: 's4',
      caption: 'Flip B to 1 as well: now the AND gate fires',
      set: { 'b.value': 1 },
      pulse: ['wb1', 'wb2', 'wc'],
      highlight: ['and'],
      camera: 'and',
    },
    {
      id: 's5',
      caption: '1 + 1 = 10 in binary: sum 0, carry 1',
      highlight: ['sum', 'carry'],
      camera: 'overview',
    },
  ],
  controls: [
    { id: 'aToggle', type: 'toggle', bind: 'a.value', label: 'A' },
    { id: 'bToggle', type: 'toggle', bind: 'b.value', label: 'B' },
  ],
};

const bits = [7, 6, 5, 4, 3, 2, 1, 0];
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸'];
const x = (bit: number) => (3.5 - bit) * 1.15;
const on = (...set: number[]) =>
  Object.fromEntries(
    bits.flatMap((bit) => [
      [`b${bit}.value`, set.includes(bit) ? 1 : 0],
      [`b${bit}.y`, set.includes(bit) ? 0.3 : 0],
    ]),
  );

export const BIT_REGISTER: DemoSpec = {
  version: 1,
  kind: 'scene3d',
  title: 'Eight bits, powers of two',
  objects: [
    { id: 'floor', type: 'grid', size: 14, at: [0, -0.56, 0] },
    ...bits.map((bit) => ({
      id: `b${bit}`,
      type: 'cell' as const,
      at: [x(bit), 0, 0] as [number, number, number],
      size: [0.95, 0.95, 0.95] as [number, number, number],
      value: 0,
      label: `2${SUPERSCRIPT[bit]}`,
      ask: `Bit ${bit}, worth 2^${bit} = ${2 ** bit}`,
    })),
    { id: 'total', type: 'label', at: [0, 1.75, 0], label: '= 0', ask: 'The number the register holds' },
  ],
  steps: [
    { id: 'zero', caption: 'Eight bits, all 0: the register holds 0', set: on() },
    {
      id: 'bit0',
      caption: 'Set bit 0: it is worth 2⁰ = 1',
      set: { ...on(0), 'total.label': '= 1' },
      pulse: ['b0'],
      highlight: ['b0'],
    },
    {
      id: 'bit1',
      caption: 'One place left is worth twice as much: 2¹ = 2',
      set: { ...on(1), 'total.label': '= 2' },
      pulse: ['b1'],
      highlight: ['b1'],
    },
    {
      id: 'bit3',
      caption: 'Each place doubles again: 2³ = 8',
      set: { ...on(3), 'total.label': '= 8' },
      pulse: ['b3'],
      highlight: ['b3'],
    },
    {
      id: 'bit7',
      caption: 'The top bit alone is 2⁷ = 128',
      set: { ...on(7), 'total.label': '= 128' },
      pulse: ['b7'],
      highlight: ['b7'],
      camera: 'b7',
    },
    {
      id: 'all',
      set: { ...on(0, 1, 2, 3, 4, 5, 6, 7), 'total.label': '= ?' },
      pulse: bits.map((bit) => `b${bit}`),
      camera: 'overview',
      checkpoint: { question: 'All eight bits are 1. What number is that?', options: ['128', '255', '256'], answer: 1 },
    },
    {
      id: 'max',
      caption: '11111111 is 255, one less than 2⁸ = 256',
      set: { 'total.label': '= 255' },
      highlight: ['total'],
      camera: { position: [5.5, 4.2, 9], target: [0, 0.2, 0] },
    },
  ],
  controls: [
    { id: 'top', type: 'toggle', bind: 'b7.value', label: 'Bit 7' },
    { id: 'low', type: 'toggle', bind: 'b0.value', label: 'Bit 0' },
  ],
};

export const DEMO_FIXTURES = { 'half-adder': HALF_ADDER, 'bit-register': BIT_REGISTER } as const;
export type DemoFixtureName = keyof typeof DEMO_FIXTURES;

export const DEMO_KIT_URL = '/vendor/interactive/demo-kit@1/demo-kit.js';

/**
 * The scene shell: the spec as an inert JSON block plus the kit script. `<`
 * is escaped so no spec string can close the script element. Story 3.1 owns
 * the production builder (packages/@openmaic/generation/src/demo-shell.ts).
 */
export function demoShellHtml(spec: DemoSpec, theme: 'light' | 'dark', kitUrl = DEMO_KIT_URL): string {
  const json = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="application/json" id="demo-spec">${json}</script><script src="${kitUrl}"></script></body></html>`;
}
