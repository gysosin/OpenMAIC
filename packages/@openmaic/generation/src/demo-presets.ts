/**
 * Parameter schemas for the demo-kit presets (PLAN.md C3, story 3.4).
 *
 * A `kind: "preset"` DemoSpec names a preset and a few params; the kit expands
 * it (lib/demo-kit/presets). These schemas are the generation side's check on
 * a model's preset request: parse, and on failure fall back to the defaults
 * (`schema.parse({})`). The kit imports only the types and normalises params
 * the same way without zod, so the defaults here must match the kit's
 * (tests/demo-kit/presets.test.ts checks this).
 */
import { z } from 'zod';

const name = z.string().trim().min(1).max(8);
const item = z.union([z.number().int().min(-9999).max(99999), z.string().trim().min(1).max(6)]);

export const bitRegisterParams = z
  .object({
    /** Register width. */
    bits: z.number().int().min(1).max(16).default(8),
    mode: z
      .enum(['counting', 'twos-complement', 'byte-groups', 'powers-of-two'])
      .default('counting'),
    /** Values to show in order; signed in twos-complement mode, else unsigned. Defaults per mode. */
    values: z.array(z.number().int()).min(1).max(16).optional(),
  })
  .superRefine((p, ctx) => {
    const [min, max] =
      p.mode === 'twos-complement'
        ? [-(2 ** (p.bits - 1)), 2 ** (p.bits - 1) - 1]
        : [0, 2 ** p.bits - 1];
    p.values?.forEach((v, i) => {
      if (v < min || v > max)
        ctx.addIssue({
          code: 'custom',
          path: ['values', i],
          message: `must fit ${p.bits} bits (${min}..${max})`,
        });
    });
  });

export const LOGIC_CIRCUITS = [
  'not',
  'and',
  'or',
  'xor',
  'nand',
  'half-adder',
  'full-adder',
  '2-to-1-mux',
  'sr-latch',
] as const;

export const logicCircuitParams = z.object({
  circuit: z.enum(LOGIC_CIRCUITS).default('half-adder'),
});

const cell = z.number().int().min(0).max(63);
const memoryOp = z.discriminatedUnion('op', [
  /** Write a value into a cell, optionally naming the variable that lives there. */
  z.object({ op: z.literal('store'), cell, value: item, name: name.optional() }),
  /** Copy a cell into register R0; `deref` follows the pointer stored in the cell. */
  z.object({ op: z.literal('load'), cell, deref: z.boolean().optional() }),
  /** Store the address of cell `to` in cell `cell` (a pointer variable). */
  z.object({ op: z.literal('pointer'), cell, to: cell, name: name.optional() }),
  z.object({ op: z.literal('push'), value: item, name: name.optional() }),
  z.object({ op: z.literal('pop') }),
  /** Call: push a return address and one slot per local. */
  z.object({ op: z.literal('frame'), name, locals: z.array(name).max(4).optional() }),
  /** Return from the latest frame: SP moves back above it. */
  z.object({ op: z.literal('return') }),
]);

export const memoryGridParams = z
  .object({
    cells: z.number().int().min(8).max(64).default(16),
    /** Bytes per cell; addresses step by this much. */
    wordSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(4),
    /** Address of cell 0. */
    base: z.number().int().min(0).max(0xffff).default(0x100),
    ops: z.array(memoryOp).min(1).max(24).optional(),
  })
  .superRefine((p, ctx) => {
    p.ops?.forEach((op, i) => {
      for (const key of ['cell', 'to'] as const) {
        const v = (op as Record<string, unknown>)[key];
        if (typeof v === 'number' && v >= p.cells)
          ctx.addIssue({
            code: 'custom',
            path: ['ops', i, key],
            message: `must be below cells (${p.cells})`,
          });
      }
    });
  });

export const DATA_STRUCTURES = [
  'array',
  'linked-list',
  'stack',
  'queue',
  'binary-tree',
  'hash-table',
] as const;

const dataOp = z.discriminatedUnion('op', [
  /** Insert (array, linked list: at `index`, default the end; stack: push; queue: enqueue; tree: BST insert). */
  z.object({
    op: z.literal('insert'),
    value: item,
    index: z.number().int().min(0).max(31).optional(),
  }),
  /** Delete a value (or, for stack and queue, pop / dequeue when no value is given). */
  z.object({
    op: z.literal('delete'),
    value: item.optional(),
    index: z.number().int().min(0).max(31).optional(),
  }),
  z.object({ op: z.literal('search'), value: item }),
  z.object({
    op: z.literal('traverse'),
    order: z.enum(['inorder', 'preorder', 'postorder', 'level']).optional(),
  }),
]);

export const dataStructureParams = z.object({
  structure: z.enum(DATA_STRUCTURES).default('linked-list'),
  /** Starting contents, inserted before the first step. Defaults per structure. */
  values: z.array(item).max(12).optional(),
  ops: z.array(dataOp).min(1).max(16).optional(),
  /** Hash table only. */
  buckets: z.number().int().min(2).max(11).default(7),
});

export const PRESET_PARAMS = {
  'bit-register': bitRegisterParams,
  'logic-circuit': logicCircuitParams,
  'memory-grid': memoryGridParams,
  'data-structure': dataStructureParams,
} as const;

export type PresetName = keyof typeof PRESET_PARAMS;
export const PRESET_NAMES = Object.keys(PRESET_PARAMS) as PresetName[];

export type BitRegisterParams = z.input<typeof bitRegisterParams>;
export type LogicCircuitParams = z.input<typeof logicCircuitParams>;
export type MemoryGridParams = z.input<typeof memoryGridParams>;
export type MemoryOp = z.infer<typeof memoryOp>;
export type DataStructureParams = z.input<typeof dataStructureParams>;
export type DataOp = z.infer<typeof dataOp>;
export type LogicCircuit = (typeof LOGIC_CIRCUITS)[number];
export type DataStructure = (typeof DATA_STRUCTURES)[number];
