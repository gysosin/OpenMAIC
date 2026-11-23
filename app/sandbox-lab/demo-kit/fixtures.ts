/**
 * Hand-written DemoSpec fixtures for the demo kit: the C3 half adder and an
 * 8-bit register (story 3.2), an HTTP request lifecycle and a CPU
 * fetch-decode-execute state machine (story 3.3, kind "flow"). Used by the
 * sandbox lab page, e2e/tests/demo-kit*.spec.ts and the kit's unit tests.
 */
import type { DemoSpec } from '@openmaic/generation';

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

export const HTTP_LIFECYCLE: DemoSpec = {
  version: 1,
  kind: 'flow',
  title: 'HTTP request lifecycle',
  objects: [
    { id: 'browser', type: 'node', label: 'Browser', icon: 'browser', ask: 'The browser that starts and finally renders the request' },
    { id: 'dns', type: 'node', label: 'DNS resolver', icon: 'globe', ask: 'Turns a host name into an IP address' },
    { id: 'tcp', type: 'node', label: 'TCP handshake', icon: 'network', ask: 'SYN, SYN-ACK, ACK: opens a reliable connection' },
    { id: 'tls', type: 'node', label: 'TLS handshake', icon: 'lock', ask: 'Agrees on keys so the rest of the exchange is encrypted' },
    { id: 'server', type: 'node', label: 'Web server', icon: 'server', ask: 'Receives the HTTP request and builds the response' },
    { id: 'db', type: 'node', label: 'Database', icon: 'database', ask: 'Stores the data the page is built from' },
    {
      id: 'response',
      type: 'node',
      label: 'HTTP response with the HTML page',
      icon: 'file',
      ask: 'Status line, headers and the HTML body sent back to the browser',
    },
    { id: 'e1', type: 'edge', from: 'browser', to: 'dns' },
    { id: 'e2', type: 'edge', from: 'dns', to: 'tcp' },
    { id: 'e3', type: 'edge', from: 'tcp', to: 'tls' },
    { id: 'e4', type: 'edge', from: 'tls', to: 'server' },
    { id: 'e5', type: 'edge', from: 'server', to: 'db', label: 'query' },
    { id: 'e6', type: 'edge', from: 'db', to: 'server', label: 'rows' },
    { id: 'e7', type: 'edge', from: 'server', to: 'response' },
    { id: 'e8', type: 'edge', from: 'response', to: 'browser', label: 'render', ask: 'The browser parses the HTML and paints the page' },
    { id: 'pkt', type: 'token', from: 'browser', label: 'example.com' },
  ],
  steps: [
    { id: 'type', caption: 'You type example.com: the browser first needs an IP address', highlight: ['browser'] },
    {
      id: 'dns',
      caption: 'A DNS resolver answers with the server’s address',
      travel: { pkt: 'e1' },
      set: { 'pkt.label': 'DNS query', 'dns.value': '93.184.216.34' },
    },
    {
      id: 'tcp',
      caption: 'A TCP handshake opens a connection to that address',
      travel: { pkt: 'e2' },
      set: { 'pkt.label': 'SYN', 'tcp.value': 'SYN · SYN-ACK · ACK' },
    },
    {
      id: 'tls',
      caption: 'TLS agrees on keys, so everything after this is encrypted',
      travel: { pkt: 'e3' },
      set: { 'pkt.label': 'ClientHello', 'tls.value': 'TLS 1.3, keys agreed' },
    },
    {
      id: 'request',
      caption: 'The encrypted HTTP request reaches the web server',
      travel: { pkt: 'e4' },
      set: { 'pkt.label': 'GET /', 'server.value': 'GET /index.html' },
    },
    { id: 'query', caption: 'The server asks the database for the page’s data', travel: { pkt: 'e5' }, set: { 'pkt.label': 'SELECT' } },
    { id: 'rows', caption: 'The rows come back to the server', travel: { pkt: 'e6' }, set: { 'pkt.label': '12 rows' } },
    {
      id: 'check',
      checkpoint: { question: 'Which step made the connection private?', options: ['DNS', 'TCP', 'TLS'], answer: 2 },
      highlight: ['tls'],
    },
    {
      id: 'respond',
      caption: 'The server sends back 200 OK with the HTML',
      travel: { pkt: 'e7' },
      set: { 'pkt.label': '200 OK', 'response.value': '200 OK · 14 KB' },
      pulse: ['response'],
    },
    {
      id: 'render',
      caption: 'The browser renders the page',
      travel: { pkt: 'e8' },
      set: { 'pkt.label': 'HTML', 'browser.value': 'Loaded in 182 ms' },
      pulse: ['browser'],
    },
  ],
  controls: [],
};

const CPU_STATES = [
  ['reset', 'Reset', 'Power-on state: registers cleared, PC = 0'],
  ['fetch', 'Fetch', 'Read the instruction at PC into the instruction register, then PC + 1'],
  ['decode', 'Decode', 'Read the opcode and pick the execute state'],
  ['alu', 'Execute ALU', 'Arithmetic or logic on two registers'],
  ['load', 'Load', 'Compute the address to read from'],
  ['store', 'Store', 'Compute the address to write to'],
  ['branch', 'Branch', 'Set PC to the jump target'],
  ['halt', 'Halt', 'Stop until reset'],
  ['memread', 'Memory read', 'Read the data word from memory'],
  ['memwrite', 'Memory write', 'Write the register to memory'],
  ['writeback', 'Write back', 'Store the result in the destination register'],
  ['irq', 'Interrupt check', 'Serve a pending interrupt, otherwise fetch the next instruction'],
] as const;

/** A 12-state fetch-decode-execute machine: two instructions, then the cycle repeats. */
export const CPU_FSM: DemoSpec = {
  version: 1,
  kind: 'flow',
  title: 'Fetch, decode, execute',
  objects: [
    ...CPU_STATES.map(([id, label, ask]) => ({ id, type: 'node' as const, shape: 'pill' as const, label, ask })),
    { id: 't0', type: 'edge', from: 'reset', to: 'fetch', label: 'power on' },
    { id: 't1', type: 'edge', from: 'fetch', to: 'decode' },
    { id: 't2', type: 'edge', from: 'decode', to: 'alu', label: 'ADD' },
    { id: 't3', type: 'edge', from: 'decode', to: 'load', label: 'LDR' },
    { id: 't4', type: 'edge', from: 'decode', to: 'store', label: 'STR' },
    { id: 't5', type: 'edge', from: 'decode', to: 'branch', label: 'B' },
    { id: 't6', type: 'edge', from: 'decode', to: 'halt', label: 'HLT' },
    { id: 't7', type: 'edge', from: 'load', to: 'memread' },
    { id: 't8', type: 'edge', from: 'store', to: 'memwrite' },
    { id: 't9', type: 'edge', from: 'alu', to: 'writeback' },
    { id: 't10', type: 'edge', from: 'memread', to: 'writeback' },
    { id: 't11', type: 'edge', from: 'writeback', to: 'irq' },
    { id: 't12', type: 'edge', from: 'memwrite', to: 'irq' },
    { id: 't13', type: 'edge', from: 'branch', to: 'irq' },
    { id: 't14', type: 'edge', from: 'irq', to: 'fetch', label: 'next', ask: 'No interrupt pending: fetch the next instruction' },
    { id: 'ins', type: 'token', from: 'reset', label: 'PC = 0', color: 'blue' },
  ],
  steps: [
    { id: 'reset', caption: 'Power on: the CPU starts in Reset with PC = 0', highlight: ['reset'] },
    { id: 'fetch', caption: 'Fetch reads the instruction at address 0', travel: { ins: 't0' }, set: { 'fetch.value': 'IR ← mem[0]' } },
    { id: 'decode', caption: 'Decode reads the opcode: ADD', travel: { ins: 't1' }, set: { 'ins.label': 'ADD r1, r2' } },
    { id: 'exec', caption: 'The ALU adds r1 and r2', travel: { ins: 't2' }, set: { 'alu.value': '3 + 4 = 7' } },
    { id: 'writeback', caption: 'The result 7 is written back to r1', travel: { ins: 't9' }, set: { 'writeback.value': 'r1 ← 7' } },
    { id: 'irq', caption: 'No interrupt is pending', travel: { ins: 't11' } },
    {
      id: 'fetch2',
      caption: 'So the next instruction is fetched',
      travel: { ins: 't14' },
      set: { 'ins.label': 'PC = 1', 'fetch.value': 'IR ← mem[1]' },
    },
    { id: 'decode2', caption: 'This one is a load: LDR', travel: { ins: 't1' }, set: { 'ins.label': 'LDR r3, [r4]' } },
    {
      id: 'check',
      checkpoint: { question: 'Which state does LDR go to after Decode?', options: ['Execute ALU', 'Load', 'Store'], answer: 1 },
      highlight: ['decode'],
    },
    { id: 'load', caption: 'Load computes the address from r4', travel: { ins: 't3' }, set: { 'load.value': 'addr = 0x40' } },
    { id: 'memread', caption: 'Memory returns the word at that address', travel: { ins: 't7' }, set: { 'memread.value': 'mem[0x40] = 9' } },
    { id: 'writeback2', caption: 'Write back puts 9 into r3', travel: { ins: 't10' }, set: { 'writeback.value': 'r3 ← 9' } },
    { id: 'loop', caption: 'And the cycle repeats until a HLT', travel: { ins: 't11' }, highlight: ['irq', 't14', 'fetch'] },
  ],
  controls: [],
};

/**
 * A layered stress graph for tests: `n` nodes in ranks of five, each feeding one
 * or two nodes in the next rank (a fixed pseudo-random pattern), plus back edges,
 * a self loop, long labels and a token walking a path.
 */
export function stressFlow(n = 30): DemoSpec {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const objects: NonNullable<DemoSpec['objects']> = [];
  const per = 5;
  for (let i = 0; i < n; i++) {
    const label = i % 7 === 3 ? `Stage ${i} with a deliberately long name` : `Stage ${i}`;
    objects.push({ id: `n${i}`, type: 'node', label, ...(i % 4 === 0 ? { icon: 'gear' as const } : {}) });
  }
  let e = 0;
  for (let i = 0; i + per < n; i++) {
    const base = (Math.floor(i / per) + 1) * per;
    const span = Math.min(per, n - base);
    const a = base + Math.floor(rand() * span);
    objects.push({ id: `e${e}`, type: 'edge', from: `n${i}`, to: `n${a}`, ...(e % 6 === 0 ? { label: `step ${e}` } : {}) });
    e++;
    if (rand() < 0.4) {
      const b = base + Math.floor(rand() * span);
      if (b !== a) objects.push({ id: `e${e++}`, type: 'edge', from: `n${i}`, to: `n${b}` });
    }
  }
  if (n > 1) objects.push({ id: `e${e++}`, type: 'edge', from: `n${n - 1}`, to: 'n0', label: 'again' });
  if (n > per * 2) objects.push({ id: `e${e++}`, type: 'edge', from: `n${per * 2}`, to: `n${per}` });
  if (n > 2) objects.push({ id: `e${e++}`, type: 'edge', from: 'n2', to: 'n2', label: 'retry' });
  objects.push({ id: 'tok', type: 'token', from: 'n0', label: 'job' });
  // The token takes the first edge out of each node it reaches.
  const edges = objects.filter((o) => o.type === 'edge');
  const steps: NonNullable<DemoSpec['steps']> = [{ id: 'start', caption: `${n} nodes`, highlight: ['n0'] }];
  let at = 'n0';
  for (let k = 0; k < 6; k++) {
    const next = edges.find((o) => o.from === at && o.to !== at);
    if (!next) break;
    steps.push({ id: `hop${k}`, caption: `Hop ${k + 1}`, travel: { tok: next.id } });
    at = next.to as string;
  }
  return { version: 1, kind: 'flow', title: `Stress flow, ${n} nodes`, objects, steps, controls: [] };
}

export const DEMO_FIXTURES = {
  'half-adder': HALF_ADDER,
  'bit-register': BIT_REGISTER,
  'http-lifecycle': HTTP_LIFECYCLE,
  'cpu-fsm': CPU_FSM,
} as const;
export type DemoFixtureName = keyof typeof DEMO_FIXTURES;

export const DEMO_KIT_URL = '/vendor/interactive/demo-kit@1/demo-kit.js';
