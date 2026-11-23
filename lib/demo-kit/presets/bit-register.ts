/**
 * bit-register preset: an n-bit register (1-16 bits) walking through values,
 * with a binary / decimal / hex readout per step.
 *
 * Modes: counting (add one, carries ripple), powers-of-two (one bit at a
 * time), twos-complement (signed values, the top bit weighs -2^(n-1), and the
 * invert-and-add-one walk for the first negative value), byte-groups (nibbles
 * read as hex digits, bytes on coloured trays). No toggles: the readout is
 * computed per step, so a toggled bit would leave it stale.
 */
import type { BitRegisterParams } from '@openmaic/generation';
import type { DemoObject, DemoSpec } from '../core/types';
import { choices, framesToSpec, int, list, oneOf, record, type Frame, type Look } from './common';

const MODES = ['counting', 'twos-complement', 'byte-groups', 'powers-of-two'] as const;
type Mode = (typeof MODES)[number];

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (k: number) => [...String(k)].map((d) => SUP[Number(d)]).join('');
const MINUS = '−';
const fmt = (v: number) => (v < 0 ? `${MINUS}${-v}` : String(v));

/** Two's complement bit pattern of v in n bits (v may be negative). */
export function bitsOf(v: number, n: number): number[] {
  const u = ((v % 2 ** n) + 2 ** n) % 2 ** n;
  return Array.from({ length: n }, (_, i) => Math.floor(u / 2 ** i) % 2);
}
/** Value of a bit pattern (index 0 = least significant), signed or unsigned. */
export function valueOf(bits: number[], signed: boolean): number {
  const n = bits.length;
  return bits.reduce((sum, b, i) => sum + b * (signed && i === n - 1 ? -(2 ** i) : 2 ** i), 0);
}
export function binary(bits: number[]): string {
  const s = [...bits].reverse().join('');
  // Group by four from the right, as written in textbooks.
  return s.replace(/\B(?=(\d{4})+$)/g, ' ');
}
export function hex(bits: number[]): string {
  const digits = Math.ceil(bits.length / 4);
  return `0x${valueOf(bits, false).toString(16).toUpperCase().padStart(digits, '0')}`;
}

function defaults(mode: Mode, n: number): number[] {
  const max = 2 ** n - 1;
  if (mode === 'powers-of-two')
    return [0, ...Array.from({ length: n }, (_, i) => 2 ** i), ...(n > 1 ? [max] : [])];
  if (mode === 'twos-complement') {
    const hi = 2 ** (n - 1) - 1;
    const lo = -(2 ** (n - 1));
    const k = n >= 4 ? 5 : 1;
    return [...new Set([0, ...(hi >= k ? [k, -k] : []), -1, hi, lo])];
  }
  if (mode === 'byte-groups') {
    const mask = (v: number) => v % 2 ** n;
    return [...new Set([0x0f, 0xf0, 0xab, ...(n > 8 ? [0x1234, 0xbeef] : [])].map(mask))];
  }
  return [...Array.from({ length: Math.min(max, 8) + 1 }, (_, i) => i), ...(max > 8 ? [max] : [])];
}

export function bitRegister(raw: BitRegisterParams | Record<string, unknown> = {}): DemoSpec {
  const p = record(raw);
  const n = int(p.bits, 1, 16, 8);
  const mode = oneOf(p.mode, MODES, 'counting');
  const signed = mode === 'twos-complement';
  const [lo, hi] = signed ? [-(2 ** (n - 1)), 2 ** (n - 1) - 1] : [0, 2 ** n - 1];
  const given = list(p.values, 16).filter(
    (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi,
  );
  const values = given.length ? given : defaults(mode, n);

  // ---------- layout ----------
  const grouped = mode === 'byte-groups';
  const PITCH = 1.15;
  const nibbleGap = grouped ? 0.45 : n > 4 ? 0.25 : 0;
  const byteGap = grouped ? 0.7 : 0;
  const rawX = (i: number) =>
    -(i * PITCH + Math.floor(i / 4) * nibbleGap + Math.floor(i / 8) * byteGap);
  const mid = (rawX(0) + rawX(n - 1)) / 2;
  const x = (i: number) => Number((rawX(i) - mid).toFixed(3));
  const width = x(0) - x(n - 1) + 1;
  const LIFT = 0.28;
  const ids = Array.from({ length: n }, (_, i) => `b${i}`);
  const nibbles = Array.from({ length: Math.ceil(n / 4) }, (_, j) => j);
  const bytes = Array.from({ length: Math.ceil(n / 8) }, (_, k) => k);
  const span = (from: number, to: number) => [x(Math.min(to, n - 1)), x(from)] as const;

  const defs: DemoObject[] = [
    { id: 'floor', type: 'grid', size: Math.ceil(width + 6), at: [0, -0.56, 0] },
    ...ids.map((id, i): DemoObject => {
      const weight = signed && i === n - 1 ? `${MINUS}2${sup(i)}` : `2${sup(i)}`;
      const worth = signed && i === n - 1 ? `${MINUS}${2 ** i}` : `${2 ** i}`;
      return {
        id,
        type: 'cell',
        at: [x(i), 0, 0],
        size: [0.95, 0.95, 0.95],
        label: weight,
        ask: `Bit ${i}, worth ${signed && i === n - 1 ? `${MINUS}2^${i}` : `2^${i}`} = ${worth}${signed && i === n - 1 ? ' (the sign bit)' : ''}`,
      };
    }),
    {
      id: 'readout',
      type: 'label',
      at: [0, grouped ? 2.45 : 1.75, 0],
      ask: 'The same bits read in binary, decimal and hexadecimal',
    },
  ];
  if (grouped) {
    for (const j of nibbles) {
      const [a, b] = span(4 * j, 4 * j + 3);
      defs.push({
        id: `h${j}`,
        type: 'label',
        at: [(a + b) / 2, 1.25, 0],
        ask: `Hex digit ${j}: bits ${4 * j} to ${Math.min(4 * j + 3, n - 1)}`,
      });
    }
    for (const k of bytes) {
      const [a, b] = span(8 * k, 8 * k + 7);
      defs.push({
        id: `byte${k}`,
        type: 'box',
        at: [(a + b) / 2, 0.25, -0.62],
        size: [b - a + 1.35, 2.3, 0.14],
        color: k % 2 ? 'teal' : 'blue',
        ask: `Byte ${k}: bits ${8 * k} to ${Math.min(8 * k + 7, n - 1)}, two hex digits`,
      });
    }
  }

  // ---------- snapshots ----------
  const read = (v: number) => {
    const bits = bitsOf(v, n);
    return `${binary(bits)} = ${fmt(valueOf(bits, signed))} = ${hex(bits)}`;
  };
  const look = (v: number, readout?: string): Record<string, Look> => {
    const bits = bitsOf(v, n);
    const show: Record<string, Look> = {};
    ids.forEach((id, i) => (show[id] = { value: bits[i], at: [x(i), bits[i] ? LIFT : 0, 0] }));
    show.readout = { label: readout ?? read(v) };
    if (grouped) {
      for (const j of nibbles) {
        const digit = bits.slice(4 * j, 4 * j + 4).reduce((s, b, i) => s + b * 2 ** i, 0);
        show[`h${j}`] = { label: digit.toString(16).toUpperCase() };
      }
    }
    return show;
  };
  const changed = (a: number, b: number) => {
    const x0 = bitsOf(a, n);
    const x1 = bitsOf(b, n);
    return ids.filter((_, i) => x0[i] !== x1[i]);
  };
  const sumOf = (v: number) => {
    const bits = bitsOf(v, n);
    const parts = bits
      .flatMap((b, i) => (b ? [signed && i === n - 1 ? -(2 ** i) : 2 ** i] : []))
      .reverse();
    if (parts.length < 2 || parts.length > 8) return '';
    return ` = ${parts.map((t, i) => (i === 0 ? fmt(t) : t < 0 ? `${MINUS} ${-t}` : `+ ${t}`)).join(' ')}`;
  };

  const frames: Frame[] = [];
  const word = n === 1 ? 'One bit' : `${n} bits`;
  let prev: number | null = null;
  const add = (v: number, frame: Omit<Frame, 'show'> & { readout?: string }) => {
    const pulse = prev === null ? [] : changed(prev, v);
    frames.push({ pulse, ...frame, show: look(v, frame.readout) });
    prev = v;
  };

  // The checkpoint goes before the value with the most 1 bits (not the first
  // value, and not the one the negation walk explains).
  const ones = (v: number) => bitsOf(v, n).filter(Boolean).length;
  const walkAt = signed ? values.findIndex((v, i) => i > 0 && v < 0 && v > lo) : -1;
  let quizAt = -1;
  values.forEach((v, i) => {
    if (i > 0 && i !== walkAt && (quizAt < 0 || ones(v) > ones(values[quizAt]))) quizAt = i;
  });

  values.forEach((v, index) => {
    const bits = bitsOf(v, n);
    const id = `v${index + 1}`;
    if (index === quizAt) {
      const answer = fmt(v);
      const distractors = signed
        ? [String(valueOf(bits, false)), fmt(-v), fmt(v + 1)]
        : [String(v + 1), String(v - 1), String(valueOf([...bits].reverse(), false))];
      const quiz = choices(
        answer,
        distractors.filter((d) => d !== '-1' || signed),
        v + n,
      );
      add(v, {
        id: `${id}-quiz`,
        readout: `${binary(bits)} = ?`,
        highlight: ids.filter((_, i) => bits[i]),
        checkpoint: {
          question: signed
            ? `As a signed ${n}-bit number, what is ${binary(bits)}?`
            : `What number is ${binary(bits)}?`,
          options: quiz.options,
          answer: quiz.answer,
        },
      });
    }
    const revealed = index === quizAt;
    if (index === 0) {
      add(v, {
        id,
        caption:
          v === 0 ? `${word}, all 0: the register holds 0` : `${word} holding ${fmt(v)}${sumOf(v)}`,
        camera: 'overview',
      });
      return;
    }
    const last = values[index - 1];
    if (index === walkAt) {
      // Negation walk: start from |v|, invert every bit, add one.
      if (last !== -v)
        add(-v, { id: `${id}-pos`, caption: `Start from +${-v}: ${binary(bitsOf(-v, n))}` });
      const inverted = valueOf(
        bitsOf(-v, n).map((b) => 1 - b),
        true,
      );
      add(inverted, {
        id: `${id}-invert`,
        caption: `To negate, invert every bit: ${binary(bitsOf(inverted, n))} (that alone is ${fmt(inverted)})`,
      });
      add(v, {
        id,
        caption: `…then add 1: ${binary(bits)} is ${fmt(v)} in two's complement`,
        highlight: [`b${n - 1}`],
      });
      return;
    }
    let caption: string;
    const pulse = changed(last, v);
    if (mode === 'counting' && v === last + 1) {
      const flipped = pulse.length;
      caption =
        flipped === 1
          ? `Add 1: bit 0 turns on, ${v} in binary is ${binary(bits)}`
          : `Add 1: ${flipped === 2 ? 'bit 0 rolls' : `bits 0–${flipped - 2} roll`} over to 0 and the carry sets bit ${flipped - 1}: ${v}`;
    } else if (mode === 'powers-of-two' && ones(v) === 1) {
      const k = bits.indexOf(1);
      caption =
        k === 0
          ? `Bit 0 alone is worth 2⁰ = 1`
          : `Bit ${k} alone is worth 2${sup(k)} = ${v}, twice bit ${k - 1}`;
    } else if (!signed && v === 2 ** n - 1 && n > 1) {
      caption = `All ${n} bits on: ${v}, one less than 2${sup(n)} = ${2 ** n}`;
    } else if (signed && v === lo) {
      caption = `Only the sign bit: ${fmt(v)}, the most negative ${n}-bit value (it has no positive partner)`;
    } else if (signed && v === -1) {
      caption = `All ones is ${MINUS}1: ${MINUS}${2 ** (n - 1)} + ${2 ** (n - 1) - 1}`;
    } else if (signed && v === hi && n > 1) {
      caption = `Sign bit 0, the rest 1: ${v}, the largest ${n}-bit signed value`;
    } else if (grouped) {
      const digits = nibbles.map((j) => {
        const nibble = bits.slice(4 * j, 4 * j + 4);
        return `${binary(nibble)} = ${valueOf(nibble, false).toString(16).toUpperCase()}`;
      });
      caption = `Each group of 4 bits is one hex digit: ${digits.reverse().join(', ')} → ${hex(bits)}`;
    } else {
      caption = `${binary(bits)} is ${fmt(v)}${sumOf(v)}`;
    }
    const top = bits[n - 1] && pulse.includes(`b${n - 1}`) && mode === 'powers-of-two';
    add(v, {
      id,
      caption,
      camera: top ? `b${n - 1}` : 'overview',
      ...(revealed ? { highlight: ['readout'] } : {}),
    });
  });

  const title =
    mode === 'twos-complement'
      ? `${n}-bit two's complement`
      : mode === 'byte-groups'
        ? `${n} bits as bytes and hex`
        : mode === 'powers-of-two'
          ? `${n} bits, powers of two`
          : `Counting in binary with ${n} bits`;
  return framesToSpec(title, defs, frames);
}
