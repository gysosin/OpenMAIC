/**
 * memory-grid preset: word-sized memory cells with hex addresses, a register
 * R0, and a stack at the top of memory that grows toward lower addresses.
 *
 * Rows run upward in address order (row 0 at the bottom, highest addresses on
 * top), so pushing moves SP down the picture as it moves down in address.
 * Pointers are cells holding another cell's address, drawn as an arrow to
 * that cell. Coloured plates behind cells mark regions: data, pointers, plain
 * pushes and one colour per call frame. Popped values stay in memory (pop
 * does not erase), their plate goes.
 */
import type { MemoryGridParams, MemoryOp } from '@openmaic/generation';
import type { DemoObject, DemoSpec, Vec3 } from '../core/types';
import {
  choices,
  framesToSpec,
  int,
  item,
  list,
  oneOf,
  plain,
  record,
  short,
  type Frame,
  type Look,
} from './common';

const COLS = 8;
const PX = 1.6;
const PY = 2;
const FRAME_COLORS = ['teal', 'purple', 'yellow', 'vermilion'] as const;

export function normaliseOps(raw: unknown, cells: number): MemoryOp[] {
  const ok = (v: unknown) => int(v, 0, cells - 1, -1) >= 0;
  const out: MemoryOp[] = [];
  for (const entry of list(raw, 24)) {
    const o = record(entry);
    const name = short(o.name, 8);
    const value = item(o.value);
    if (o.op === 'store' && ok(o.cell) && value !== undefined)
      out.push({ op: 'store', cell: o.cell as number, value, name });
    else if (o.op === 'load' && ok(o.cell))
      out.push({ op: 'load', cell: o.cell as number, deref: o.deref === true });
    else if (o.op === 'pointer' && ok(o.cell) && ok(o.to))
      out.push({ op: 'pointer', cell: o.cell as number, to: o.to as number, name });
    else if (o.op === 'push' && value !== undefined) out.push({ op: 'push', value, name });
    else if (o.op === 'pop' || o.op === 'return') out.push({ op: o.op });
    else if (o.op === 'frame' && name) {
      const locals = list(o.locals, 4)
        .map((l) => short(l, 8))
        .filter((l): l is string => Boolean(l));
      out.push({ op: 'frame', name, locals });
    }
  }
  return out;
}

const DEFAULT_OPS: MemoryOp[] = [
  { op: 'store', cell: 0, value: 42, name: 'x' },
  { op: 'store', cell: 1, value: 7, name: 'y' },
  { op: 'pointer', cell: 2, to: 0, name: 'p' },
  { op: 'load', cell: 2, deref: true },
  { op: 'frame', name: 'f', locals: ['i'] },
  { op: 'push', value: 3 },
  { op: 'push', value: 5 },
  { op: 'pop' },
  { op: 'return' },
];

interface Slot {
  value?: string | number;
  name?: string;
  /** Plate colour; undefined = no plate. */
  region?: string;
}

export function memoryGrid(raw: MemoryGridParams | Record<string, unknown> = {}): DemoSpec {
  const p = record(raw);
  const cells = int(p.cells, 8, 64, 16);
  const w = oneOf(p.wordSize, [1, 2, 4, 8] as const, 4);
  const base = int(p.base, 0, 0xffff, 0x100);
  const given = normaliseOps(p.ops, cells);
  const ops = given.length ? given : DEFAULT_OPS;

  const digits = Math.max(3, (base + cells * w).toString(16).length);
  const addr = (i: number) =>
    `0x${(base + i * w).toString(16).toUpperCase().padStart(digits, '0')}`;
  const rows = Math.ceil(cells / COLS);
  const pos = (i: number): Vec3 => {
    // The address just past the end sits right after the last cell.
    const k = i >= cells ? cells - 1 : i;
    const col = (k % COLS) + (i >= cells ? 1 : 0);
    return [(col - (COLS - 1) / 2) * PX, (Math.floor(k / COLS) - (rows - 1) / 2) * PY, 0];
  };
  const cellIds = Array.from({ length: cells }, (_, i) => `m${i}`);
  // Clear of the SP badge, which sits one slot past the last cell when the stack is empty.
  const right = (COLS / 2) * PX + 3.4;
  const top = ((rows - 1) / 2) * PY;
  const regs: Vec3[] = [
    [right, top, 0],
    [right, top - PY, 0],
  ];

  // ---------- simulate ----------
  const mem: Slot[] = Array.from({ length: cells }, () => ({}));
  const pointers = new Map<number, number>();
  const frames: Frame[] = [];
  /** Open call frames: SP before the call (`start`) and after its slots were pushed (`top`). */
  const stack: { name: string; start: number; top: number; color: string }[] = [];
  const plates = new Set<number>();
  const arrows = new Map<string, DemoObject>();
  let sp = cells;
  let r0: string | number = '';
  const arrowId = (from: number, to: number) => {
    const id = `ptr-${from}-${to}`;
    if (!arrows.has(id)) {
      const a = pos(from);
      const b = pos(to);
      const d = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(d[0], d[1]) || 1;
      const u = [d[0] / len, d[1] / len];
      const z = 0.45;
      arrows.set(id, {
        id,
        type: 'arrow',
        color: 'orange',
        from: [a[0] + u[0] * 0.55, a[1] + u[1] * 0.4, z],
        to: [b[0] - u[0] * 0.72, b[1] - u[1] * 0.55, z],
        ask: `Pointer: ${addr(from)} holds ${addr(to)}, the address of this cell`,
      });
    }
    return id;
  };
  const snapshot = (): Record<string, Look> => {
    const show: Record<string, Look> = {};
    mem.forEach((slot, i) => {
      show[cellIds[i]] = {
        value: slot.value === undefined ? '' : plain(slot.value),
        label: slot.name ? `${slot.name}  ${addr(i)}` : addr(i),
      };
      if (slot.region) {
        plates.add(i);
        show[`pl${i}`] = { color: slot.region };
      }
    });
    for (const [from, to] of pointers) if (from !== to) show[arrowId(from, to)] = {};
    const at = pos(sp);
    show.sp = { at: [at[0] + 0.62, at[1] + 0.42, 0.42] };
    show.spreg = { value: addr(sp) };
    show.r0 = { value: r0 === '' ? '' : plain(r0) };
    return show;
  };
  const name = (i: number) => mem[i].name ?? addr(i);
  const stackOps = ops.findIndex((o) => o.op === 'push' || o.op === 'frame');
  const quizLoad = stackOps < 0 ? ops.findIndex((o) => o.op === 'load') : -1;

  frames.push({
    id: 'memory',
    caption: `${cells} cells of ${w} byte${w > 1 ? 's' : ''}, addresses ${addr(0)} to ${addr(cells - 1)}. The stack starts at the top: SP = ${addr(cells)}`,
    show: snapshot(),
    camera: 'overview',
  });

  const push = (value: string | number, slotName: string | undefined, region: string): boolean => {
    const next = sp - 1;
    // Never clobber live data or pointers: that is a stack overflow.
    if (next < 0 || mem[next].region === 'blue' || mem[next].region === 'orange') return false;
    sp = next;
    mem[sp] = { value, name: slotName, region };
    return true;
  };

  ops.forEach((op, k) => {
    const id = `op${k + 1}-${op.op}`;
    if (k === stackOps) {
      const quiz = choices(
        'Toward lower addresses',
        ['Toward higher addresses', 'It does not move'],
        1,
      );
      frames.push({
        id: 'stack-quiz',
        show: snapshot(),
        highlight: ['spreg'],
        checkpoint: {
          question: `SP is ${addr(sp)}. Which way does the stack grow when we push?`,
          ...quiz,
        },
      });
    }
    if (op.op === 'store') {
      pointers.delete(op.cell);
      mem[op.cell] = { value: op.value, name: op.name ?? mem[op.cell].name, region: 'blue' };
      frames.push({
        id,
        caption: `${op.name ? `${op.name} = ${op.value}: ` : ''}store ${op.value} at ${addr(op.cell)}`,
        show: snapshot(),
        pulse: [cellIds[op.cell]],
        highlight: [cellIds[op.cell]],
      });
    } else if (op.op === 'pointer') {
      pointers.set(op.cell, op.to);
      mem[op.cell] = { value: addr(op.to), name: op.name ?? mem[op.cell].name, region: 'orange' };
      const who = mem[op.to].name ? `&${mem[op.to].name}` : addr(op.to);
      frames.push({
        id,
        caption: `${op.name ?? addr(op.cell)} = ${who}: it stores the address ${addr(op.to)}, so it points at that cell`,
        show: snapshot(),
        pulse: [cellIds[op.cell], ...(op.cell !== op.to ? [arrowId(op.cell, op.to)] : [])],
        highlight: [cellIds[op.cell], cellIds[op.to]],
      });
    } else if (op.op === 'load') {
      const target = op.deref && pointers.has(op.cell) ? pointers.get(op.cell)! : op.cell;
      const value = mem[target].value ?? 0;
      if (k === quizLoad) {
        const v = String(value);
        const quiz = choices(v, [String(mem[op.cell].value ?? 0), addr(target), '0'], k);
        frames.push({
          id: 'load-quiz',
          show: snapshot(),
          highlight: [cellIds[op.cell]],
          checkpoint: {
            question: `What will R0 hold after loading ${op.deref ? `*${name(op.cell)}` : name(op.cell)}?`,
            ...quiz,
          },
        });
      }
      r0 = value;
      const via = target !== op.cell;
      frames.push({
        id,
        caption: via
          ? `*${name(op.cell)}: follow the address ${addr(target)} and load what is there: R0 = ${value}`
          : `Load ${addr(op.cell)} into R0: R0 = ${value}`,
        show: snapshot(),
        pulse: ['r0', ...(via ? [arrowId(op.cell, target)] : [])],
        highlight: [cellIds[target], ...(via ? [cellIds[op.cell]] : [])],
      });
    } else if (op.op === 'push') {
      const ok = push(op.value, op.name, stack.length ? stack[stack.length - 1].color : 'sky');
      frames.push({
        id,
        caption: ok
          ? `Push ${op.value}: SP moves down one word to ${addr(sp)}, then ${op.value} is written there`
          : `Push ${op.value}: no room below SP, a stack overflow, so nothing is written`,
        show: snapshot(),
        pulse: ok ? [cellIds[sp], 'spreg'] : ['spreg'],
        highlight: ok ? [cellIds[sp]] : [],
      });
    } else if (op.op === 'pop') {
      const floor = stack.length ? stack[stack.length - 1].top : cells;
      if (sp >= floor) {
        frames.push({
          id,
          caption: 'Pop: nothing pushed in this frame, so there is nothing to pop',
          show: snapshot(),
        });
        return;
      }
      const at = sp;
      r0 = mem[at].value ?? 0;
      mem[at] = { value: mem[at].value };
      sp += 1;
      frames.push({
        id,
        caption: `Pop: read ${r0} into R0 and move SP up to ${addr(sp)}. The ${r0} stays in memory, the slot is just free now`,
        show: snapshot(),
        pulse: ['r0', 'spreg'],
        highlight: [cellIds[at]],
      });
    } else if (op.op === 'frame') {
      const color = FRAME_COLORS[stack.length % FRAME_COLORS.length];
      const start = sp;
      const ret = `0x${(0x400 + 0x24 * (stack.length + 1)).toString(16).toUpperCase()}`;
      const slots: [string | number, string][] = [
        [ret, 'ret'],
        ...(op.locals ?? []).map((l): [string, string] => ['?', l]),
      ];
      let pushed = 0;
      for (const [value, slotName] of slots) if (push(value, slotName, color)) pushed++;
      stack.push({ name: op.name, start, top: sp, color });
      const locals = op.locals?.length ? ` and room for ${op.locals.join(', ')}` : '';
      frames.push({
        id,
        caption:
          pushed === slots.length
            ? `Call ${op.name}(): push the return address${locals}. Its frame runs from ${addr(start - 1)} down to SP = ${addr(sp)}`
            : `Call ${op.name}(): the frame does not fit below SP, a stack overflow`,
        show: snapshot(),
        pulse: ['spreg'],
        highlight: Array.from({ length: start - sp }, (_, j) => cellIds[sp + j]),
      });
    } else if (op.op === 'return') {
      const frame = stack.pop();
      if (!frame) {
        frames.push({ id, caption: 'Return: no call frame is open', show: snapshot() });
        return;
      }
      for (let i = sp; i < frame.start; i++) mem[i] = { value: mem[i].value };
      const was = sp;
      sp = frame.start;
      frames.push({
        id,
        caption: `Return from ${frame.name}(): SP jumps back up to ${addr(sp)}; the frame's slots are free again (their old values linger)`,
        show: snapshot(),
        pulse: ['spreg'],
        highlight: Array.from({ length: frame.start - was }, (_, j) => cellIds[was + j]),
      });
    }
  });

  const defs: DemoObject[] = [
    ...cellIds.flatMap((id, i): DemoObject[] => [
      ...(plates.has(i)
        ? [
            {
              id: `pl${i}`,
              type: 'box' as const,
              at: [pos(i)[0], pos(i)[1], -0.3] as Vec3,
              size: [1.56, 1.16, 0.12] as Vec3,
            },
          ]
        : []),
      {
        id,
        type: 'cell',
        at: pos(i),
        size: [1.4, 1, 0.5],
        ask: `Memory cell at address ${addr(i)} (${w} byte${w > 1 ? 's' : ''})`,
      },
    ]),
    ...arrows.values(),
    {
      id: 'sp',
      type: 'sphere',
      size: 0.16,
      color: 'accent',
      label: 'SP',
      ask: 'SP, the stack pointer: the address of the top of the stack',
    },
    {
      id: 'spreg',
      type: 'cell',
      at: regs[0],
      size: [1.9, 1, 0.5],
      label: 'SP register',
      ask: 'Stack pointer register',
    },
    {
      id: 'r0',
      type: 'cell',
      at: regs[1],
      size: [1.9, 1, 0.5],
      label: 'R0 register',
      ask: 'Register R0: loads and pops land here',
    },
  ];
  return framesToSpec('Memory, addresses and the stack', defs, frames);
}
