/**
 * data-structure preset: array, linked list, stack, queue, binary search tree
 * or hash table (separate chaining), with insert / delete / search / traverse
 * ops. Each op is simulated on a real structure and every intermediate state
 * becomes a step: comparisons one at a time, the shift before an array
 * insert, the pointer rewire before a list node moves in, the in-order
 * successor in a two-child BST delete, the hash before a chained insert.
 *
 * Node values sit on neutral cells; a plate behind each node carries its
 * state colour (blue resting, orange being compared, teal found, violet new,
 * vermilion leaving, yellow visited), so the numbers stay readable in both
 * themes.
 */
import type { DataOp, DataStructure, DataStructureParams } from '@openmaic/generation';
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
  type Frame,
  type Look,
} from './common';

export const STRUCTURES = [
  'array',
  'linked-list',
  'stack',
  'queue',
  'binary-tree',
  'hash-table',
] as const satisfies readonly DataStructure[];
const ORDERS = ['inorder', 'preorder', 'postorder', 'level'] as const;

type Item = number | string;
type Mark = 'compare' | 'found' | 'new' | 'gone' | 'visit';
const MARK: Record<Mark | 'rest', string> = {
  rest: 'blue',
  compare: 'orange',
  found: 'teal',
  new: 'accent',
  gone: 'vermilion',
  visit: 'yellow',
};
const MAX_FRAMES = 90;

/** Numbers by value, anything else as text. */
export const cmp = (a: Item, b: Item): number =>
  typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a) < String(b)
      ? -1
      : String(a) > String(b)
        ? 1
        : 0;
/** h(k) = k mod m; a string key hashes to the sum of its character codes. */
export function hashOf(key: Item, m: number): { code: number; bucket: number } {
  const code = typeof key === 'number' ? key : [...key].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return { code, bucket: ((code % m) + m) % m };
}

export function normaliseOps(raw: unknown): DataOp[] {
  const out: DataOp[] = [];
  for (const entry of list(raw, 16)) {
    const o = record(entry);
    const value = item(o.value);
    const index = int(o.index, 0, 31, -1);
    const at = index >= 0 ? { index } : {};
    if (o.op === 'insert' && value !== undefined) out.push({ op: 'insert', value, ...at });
    else if (o.op === 'delete')
      out.push({ op: 'delete', ...(value !== undefined ? { value } : {}), ...at });
    else if (o.op === 'search' && value !== undefined) out.push({ op: 'search', value });
    else if (o.op === 'traverse')
      out.push({ op: 'traverse', order: oneOf(o.order, ORDERS, 'inorder') });
  }
  return out;
}

const DEFAULTS: Record<DataStructure, { values: Item[]; ops: DataOp[] }> = {
  array: {
    values: [5, 12, 7, 3],
    ops: [
      { op: 'insert', value: 9, index: 1 },
      { op: 'search', value: 3 },
      { op: 'delete', value: 12 },
      { op: 'traverse' },
    ],
  },
  'linked-list': {
    values: [3, 8, 5],
    ops: [
      { op: 'insert', value: 4, index: 1 },
      { op: 'search', value: 5 },
      { op: 'delete', value: 8 },
      { op: 'insert', value: 1, index: 0 },
    ],
  },
  stack: {
    values: [4, 9],
    ops: [
      { op: 'insert', value: 7 },
      { op: 'insert', value: 2 },
      { op: 'delete' },
      { op: 'delete' },
      { op: 'search', value: 4 },
    ],
  },
  queue: {
    values: [4, 9],
    ops: [
      { op: 'insert', value: 7 },
      { op: 'delete' },
      { op: 'insert', value: 2 },
      { op: 'delete' },
    ],
  },
  'binary-tree': {
    values: [8, 3, 10, 1, 6, 14, 4, 7],
    ops: [
      { op: 'insert', value: 5 },
      { op: 'search', value: 7 },
      { op: 'delete', value: 3 },
      { op: 'traverse', order: 'inorder' },
    ],
  },
  'hash-table': {
    values: [12, 7, 22, 5, 17],
    ops: [
      { op: 'insert', value: 19 },
      { op: 'search', value: 5 },
      { op: 'delete', value: 12 },
      { op: 'search', value: 9 },
    ],
  },
};

/** Shared scene bookkeeping: node ids, edges, frames. */
class Scene {
  readonly frames: Frame[] = [];
  readonly values = new Map<string, Item>();
  readonly edges = new Map<string, [string, string]>();
  readonly labels = new Map<string, Vec3>();
  private next = 0;
  quizzed = false;

  make(value: Item): string {
    const id = `n${this.next++}`;
    this.values.set(id, value);
    return id;
  }
  get full(): boolean {
    return this.frames.length >= MAX_FRAMES;
  }
  /** A node: its cell, its state plate, and optionally a small label under it. */
  node(
    show: Record<string, Look>,
    id: string,
    at: Vec3,
    mark?: Mark,
    label?: string,
    value?: Item,
  ): void {
    show[id] = { at, value: plain(value ?? this.values.get(id)!), label };
    show[`q${id.slice(1)}`] = { at: [at[0], at[1], -0.3], color: MARK[mark ?? 'rest'] };
  }
  edge(show: Record<string, Look>, from: string, to: string): void {
    const id = `e-${from}-${to}`;
    this.edges.set(id, [from, to]);
    show[id] = {};
  }
  label(show: Record<string, Look>, id: string, at: Vec3, text: string): void {
    this.labels.set(id, at);
    show[id] = { at, label: text };
  }
  push(frame: Frame): void {
    if (!this.full) this.frames.push(frame);
  }
  /** One checkpoint per demo, before the first op that fits one. */
  quiz(show: Record<string, Look>, question: string, answer: string, distractors: string[]): void {
    const c = choices(answer, distractors, this.frames.length);
    if (this.quizzed || c.options.length < 2) return;
    this.quizzed = true;
    this.push({ id: 'quiz', show, checkpoint: { question, options: c.options, answer: c.answer } });
  }
}

type Marks = Record<string, Mark>;
const fmt = (v: Item) => (typeof v === 'string' ? `"${v}"` : v < 0 ? `−${-v}` : String(v));

// ---------- linear structures: array, stack, queue ----------

function linear(kind: 'array' | 'stack' | 'queue', values: Item[], ops: DataOp[], s: Scene): void {
  let items = values.map((v) => s.make(v));
  const cap = Math.max(values.length + ops.filter((o) => o.op === 'insert').length, 1);
  const P = kind === 'stack' ? 1.25 : 1.5;
  const pos = (i: number): Vec3 =>
    kind === 'stack'
      ? [0, Number(((i - (cap - 1) / 2) * P).toFixed(3)), 0]
      : [Number(((i - (cap - 1) / 2) * P).toFixed(3)), 0, 0];
  const outAt: Vec3 = kind === 'stack' ? [3.4, 0, 0] : [0, 1.75, 0];
  const name = kind === 'array' ? 'array' : kind;
  const snap = (
    marks: Marks = {},
    out = '',
    slot = (i: number) => i,
    extra?: (show: Record<string, Look>) => void,
  ) => {
    const show: Record<string, Look> = {};
    items.forEach((id, i) => {
      const label =
        kind === 'array'
          ? `[${slot(i)}]`
          : kind === 'stack'
            ? ''
            : [i === 0 ? 'front' : '', i === items.length - 1 ? 'rear' : '']
                .filter(Boolean)
                .join(' · ');
      s.node(show, id, pos(slot(i)), marks[id], label);
    });
    // Cell labels sit under the cell, which in a column reads as the next item's: mark the top beside it.
    if (kind === 'stack' && items.length)
      s.label(show, 'top', [-1.7, pos(items.length - 1)[1], 0], 'top ▸');
    if (out) s.label(show, 'out', outAt, out);
    extra?.(show);
    return show;
  };
  // Order in which search and traverse look at the items.
  const scanOrder = () => (kind === 'stack' ? [...items].reverse() : [...items]);
  const scanWord =
    kind === 'stack' ? 'from the top' : kind === 'queue' ? 'from the front' : 'from index 0';
  const v = (id: string) => s.values.get(id)!;

  s.push({
    id: 'start',
    caption: items.length
      ? `${kind === 'array' ? 'An array' : `A ${kind}`} holding ${items.map((id) => fmt(v(id))).join(', ')}`
      : `An empty ${name}`,
    show: snap(),
    camera: 'overview',
  });

  /** Compare one by one; returns the index in `items` or -1. */
  const scan = (target: Item, verb: string): number => {
    const order = scanOrder();
    for (let k = 0; k < order.length && !s.full; k++) {
      const id = order[k];
      const hit = cmp(v(id), target) === 0;
      s.push({
        id: `${verb}-${fmt(target)}-${k + 1}`,
        caption: hit
          ? `Compare ${fmt(v(id))} with ${fmt(target)}: equal, found after ${k + 1} comparison${k ? 's' : ''}`
          : `Compare ${fmt(v(id))} with ${fmt(target)}: not equal, keep going`,
        show: snap({ [id]: hit ? 'found' : 'compare' }),
        pulse: [id],
      });
      if (hit) return items.indexOf(id);
    }
    s.push({
      id: `${verb}-${fmt(target)}-miss`,
      caption: `${fmt(target)} is not here: all ${order.length} item${order.length === 1 ? '' : 's'} compared`,
      show: snap(),
    });
    return -1;
  };

  for (const op of ops) {
    if (s.full) break;
    if (op.op === 'insert') {
      const at = kind === 'array' ? Math.min(op.index ?? items.length, items.length) : items.length;
      if (kind === 'array' && !s.quizzed && at < items.length) {
        const moves = items.length - at;
        s.quiz(
          snap(),
          `Insert ${fmt(op.value)} at index ${at}: how many elements must move?`,
          String(moves),
          [String(moves + 1), '0', String(Math.max(moves - 1, 1))],
        );
      }
      if (kind === 'array' && at < items.length) {
        const moved = items.slice(at);
        s.push({
          id: `insert-${fmt(op.value)}-shift`,
          caption: `Insert ${fmt(op.value)} at index ${at}: first shift the ${moved.length} element${moved.length > 1 ? 's' : ''} from index ${at} one place right`,
          show: snap(Object.fromEntries(moved.map((id) => [id, 'visit'])), '', (i) =>
            i >= at ? i + 1 : i,
          ),
          pulse: moved,
        });
      }
      const id = s.make(op.value);
      items.splice(at, 0, id);
      s.push({
        id: `insert-${fmt(op.value)}`,
        caption:
          kind === 'stack'
            ? `Push ${fmt(op.value)}: it goes on top`
            : kind === 'queue'
              ? `Enqueue ${fmt(op.value)}: it joins at the rear`
              : `Write ${fmt(op.value)} into index ${at}; the array now has ${items.length} elements`,
        show: snap({ [id]: 'new' }),
        pulse: [id],
      });
    } else if (op.op === 'delete') {
      let at: number;
      if (kind === 'array') {
        at =
          op.value !== undefined
            ? scan(op.value, 'delete')
            : Math.min(op.index ?? items.length - 1, items.length - 1);
      } else {
        at = kind === 'stack' ? items.length - 1 : 0;
      }
      if (at < 0 || items.length === 0) {
        if (items.length === 0)
          s.push({
            id: 'delete-empty',
            caption: `The ${name} is empty: nothing to remove`,
            show: snap(),
          });
        continue;
      }
      const id = items[at];
      if (kind !== 'array') {
        const others = items.filter((x) => x !== id).map((x) => String(v(x)));
        s.quiz(
          snap(),
          `What does ${kind === 'stack' ? 'pop' : 'dequeue'} return?`,
          String(v(id)),
          others.slice(-2),
        );
      }
      const note =
        op.value !== undefined && kind !== 'array' && cmp(op.value, v(id)) !== 0
          ? ` (a ${kind} can only remove its ${kind === 'stack' ? 'top' : 'front'})`
          : '';
      s.push({
        id: `delete-${fmt(v(id))}`,
        caption:
          kind === 'stack'
            ? `Pop takes the top: ${fmt(v(id))}${note}`
            : kind === 'queue'
              ? `Dequeue takes the front, the oldest item: ${fmt(v(id))}${note}`
              : `Delete ${fmt(v(id))} at index ${at}`,
        show: snap({ [id]: 'gone' }),
        pulse: [id],
      });
      items.splice(at, 1);
      const moved = kind === 'stack' ? [] : items.slice(at);
      s.push({
        id: `delete-${fmt(v(id))}-done`,
        caption:
          kind === 'array'
            ? moved.length
              ? `Shift the ${moved.length} element${moved.length > 1 ? 's' : ''} after it one place left to close the gap`
              : 'It was the last element: nothing to shift'
            : kind === 'stack'
              ? items.length
                ? `${fmt(v(items[items.length - 1]))} is the new top`
                : 'The stack is empty again'
              : items.length
                ? `Everyone moves up: ${fmt(v(items[0]))} is at the front`
                : 'The queue is empty again',
        show: snap(
          Object.fromEntries(moved.map((x) => [x, 'visit'])),
          `${kind === 'stack' ? 'pop' : kind === 'queue' ? 'dequeue' : 'removed'} → ${fmt(v(id))}`,
        ),
        pulse: moved,
      });
    } else if (op.op === 'search') {
      if (!s.quizzed && kind === 'array') {
        const n = items.findIndex((id) => cmp(v(id), op.value) === 0);
        const answer = n < 0 ? items.length : n + 1;
        s.quiz(
          snap(),
          `Linear search for ${fmt(op.value)}: how many comparisons?`,
          String(answer),
          [String(answer + 1), String(Math.max(answer - 1, 1)), '1'],
        );
      }
      s.push({
        id: `search-${fmt(op.value)}`,
        caption: `Search for ${fmt(op.value)}, ${scanWord}`,
        show: snap(),
      });
      scan(op.value, 'search');
    } else if (op.op === 'traverse') {
      const seen: string[] = [];
      for (const id of scanOrder()) {
        if (s.full) break;
        seen.push(String(fmt(v(id))));
        s.push({
          id: `visit-${fmt(v(id))}`,
          caption: `Visit ${fmt(v(id))}`,
          show: snap({ [id]: 'visit' }, `visited: ${seen.join(' ')}`),
          pulse: [id],
        });
      }
    }
  }
}

// ---------- linked list ----------

function linkedList(values: Item[], ops: DataOp[], s: Scene): void {
  let order = values.map((v) => s.make(v));
  const cap = Math.max(values.length + ops.filter((o) => o.op === 'insert').length, 1);
  const P = 2.2;
  const x = (i: number) => Number(((i - (cap - 1) / 2) * P).toFixed(3));
  const v = (id: string) => s.values.get(id)!;
  const HEAD: Vec3 = [x(-1) + 0.5, 0, 0];

  /** extra nodes (not yet linked) and edge overrides; default edges follow `order`. */
  const snap = (
    marks: Marks = {},
    opts: { extra?: [string, Vec3][]; edges?: [string, string][]; out?: string } = {},
  ) => {
    const show: Record<string, Look> = {};
    s.label(show, 'head', HEAD, 'head');
    order.forEach((id, i) => s.node(show, id, [x(i), 0, 0], marks[id]));
    for (const [id, at] of opts.extra ?? []) s.node(show, id, at, marks[id]);
    s.label(show, 'nil', [x(order.length) - 0.3, 0, 0], 'null');
    const edges = opts.edges ?? chain();
    for (const [from, to] of edges) s.edge(show, from, to);
    if (opts.out) s.label(show, 'out', [0, 1.75, 0], opts.out);
    return show;
  };
  const chain = (list = order): [string, string][] => {
    const ids = ['head', ...list, 'nil'];
    return ids.slice(0, -1).map((id, i) => [id, ids[i + 1]]);
  };
  const arrowText = () =>
    order.length ? order.map((id) => fmt(v(id))).join(' → ') + ' → null' : 'head → null';

  s.push({
    id: 'start',
    caption: `A linked list: ${arrowText()}`,
    show: snap(),
    camera: 'overview',
  });

  const walk = (target: Item, verb: string): number => {
    for (let k = 0; k < order.length && !s.full; k++) {
      const id = order[k];
      const hit = cmp(v(id), target) === 0;
      s.push({
        id: `${verb}-${fmt(target)}-${k + 1}`,
        caption: hit
          ? `Node ${fmt(v(id))} matches: found after following ${k} next pointer${k === 1 ? '' : 's'}`
          : `Node ${fmt(v(id))} is not ${fmt(target)}: follow its next pointer`,
        show: snap({ [id]: hit ? 'found' : 'compare' }),
        pulse: [id],
      });
      if (hit) return k;
    }
    s.push({
      id: `${verb}-${fmt(target)}-miss`,
      caption: `Reached null: ${fmt(target)} is not in the list`,
      show: snap(),
    });
    return -1;
  };

  for (const op of ops) {
    if (s.full) break;
    if (op.op === 'insert') {
      const at = Math.min(op.index ?? order.length, order.length);
      const id = s.make(op.value);
      const pred = at === 0 ? 'head' : order[at - 1];
      const succ = order[at] ?? 'nil';
      const below: Vec3 = [x(at) - P / 2, -1.9, 0];
      s.push({
        id: `insert-${fmt(op.value)}-new`,
        caption: `Create node ${fmt(op.value)} and point its next at ${succ === 'nil' ? 'null' : `node ${fmt(v(succ))}`}`,
        show: snap({ [id]: 'new' }, { extra: [[id, below]], edges: [...chain(), [id, succ]] }),
        pulse: [id],
      });
      order.splice(at, 0, id);
      s.push({
        id: `insert-${fmt(op.value)}`,
        caption: `Then ${pred === 'head' ? 'head' : `${fmt(v(pred))}.next`} = node ${fmt(op.value)}: ${arrowText()}`,
        show: snap({ [id]: 'new' }),
        pulse: [id],
      });
    } else if (op.op === 'delete') {
      const target =
        op.value ?? (op.index !== undefined && order[op.index] ? v(order[op.index]) : undefined);
      if (target === undefined) continue;
      const k = order.findIndex((id) => cmp(v(id), target) === 0);
      if (k > 0) {
        s.quiz(
          snap(),
          `To delete ${fmt(target)}, whose next pointer must change?`,
          `Node ${fmt(v(order[k - 1]))}`,
          [
            `Node ${fmt(target)}`,
            'head',
            ...(order[k + 1] ? [`Node ${fmt(v(order[k + 1]))}`] : []),
          ],
        );
      }
      const found = walk(target, 'delete');
      if (found < 0) continue;
      const id = order[found];
      const pred = found === 0 ? 'head' : order[found - 1];
      const succ = order[found + 1] ?? 'nil';
      const rest = order.filter((n) => n !== id);
      s.push({
        id: `delete-${fmt(target)}-bypass`,
        caption: `${pred === 'head' ? 'head' : `${fmt(v(pred))}.next`} = ${succ === 'nil' ? 'null' : `node ${fmt(v(succ))}`}: skip over ${fmt(target)}`,
        show: snap({ [id]: 'gone' }, { edges: [...chain(rest), [id, succ]] }),
        pulse: [pred === 'head' ? id : pred],
      });
      order = rest;
      s.push({
        id: `delete-${fmt(target)}`,
        caption: `Node ${fmt(target)} is unlinked and freed: ${arrowText()}`,
        show: snap(),
      });
    } else if (op.op === 'search') {
      if (!s.quizzed) {
        const k = order.findIndex((id) => cmp(v(id), op.value) === 0);
        const answer = k < 0 ? order.length : k + 1;
        s.quiz(snap(), `How many nodes are visited to find ${fmt(op.value)}?`, String(answer), [
          String(answer + 1),
          '1',
          String(order.length + 1),
        ]);
      }
      walk(op.value, 'search');
    } else if (op.op === 'traverse') {
      const seen: string[] = [];
      for (const id of order) {
        if (s.full) break;
        seen.push(String(fmt(v(id))));
        s.push({
          id: `visit-${fmt(v(id))}`,
          caption: `Visit ${fmt(v(id))}, then follow next`,
          show: snap({ [id]: 'visit' }, { out: `visited: ${seen.join(' ')}` }),
          pulse: [id],
        });
      }
    }
  }
}

// ---------- binary search tree ----------

interface TreeNode {
  left?: string;
  right?: string;
}

function binaryTree(values: Item[], ops: DataOp[], s: Scene): void {
  const tree = new Map<string, TreeNode>();
  let root: string | undefined;
  const v = (id: string) => s.values.get(id)!;
  /** Path of node ids from the root while looking for `key`; the last entry is a match or the parent of its empty spot. */
  const path = (key: Item): string[] => {
    const out: string[] = [];
    let at = root;
    while (at) {
      out.push(at);
      const c = cmp(key, v(at));
      if (c === 0) break;
      at = c < 0 ? tree.get(at)!.left : tree.get(at)!.right;
    }
    return out;
  };
  const insert = (key: Item): string | null => {
    const p = path(key);
    const last = p[p.length - 1];
    if (last && cmp(key, v(last)) === 0) return null;
    const id = s.make(key);
    tree.set(id, {});
    if (!last) root = id;
    else if (cmp(key, v(last)) < 0) tree.get(last)!.left = id;
    else tree.get(last)!.right = id;
    return id;
  };
  // No default for `at`: an undefined child must not restart at the root.
  const inorder = (at: string | undefined, out: string[] = []): string[] => {
    if (!at) return out;
    inorder(tree.get(at)!.left, out);
    out.push(at);
    inorder(tree.get(at)!.right, out);
    return out;
  };
  const depthOf = (): Map<string, number> => {
    const d = new Map<string, number>();
    const walk = (at: string | undefined, k: number) => {
      if (!at) return;
      d.set(at, k);
      walk(tree.get(at)!.left, k + 1);
      walk(tree.get(at)!.right, k + 1);
    };
    walk(root, 0);
    return d;
  };
  const snap = (marks: Marks = {}, out = '', values: Record<string, Item> = {}) => {
    const show: Record<string, Look> = {};
    const ranks = inorder(root);
    const depth = depthOf();
    const n = ranks.length;
    ranks.forEach((id, r) =>
      s.node(
        show,
        id,
        [Number(((r - (n - 1) / 2) * 1.3).toFixed(3)), -depth.get(id)! * 1.7, 0],
        marks[id],
        undefined,
        values[id],
      ),
    );
    for (const [id, node] of tree) {
      if (!depth.has(id)) continue;
      if (node.left) s.edge(show, id, node.left);
      if (node.right) s.edge(show, id, node.right);
    }
    if (out) s.label(show, 'out', [0, 1.6, 0], out);
    return show;
  };
  const step = (key: Item, at: string) => {
    const c = cmp(key, v(at));
    return c === 0
      ? `${fmt(key)} = ${fmt(v(at))}`
      : c < 0
        ? `${fmt(key)} < ${fmt(v(at))}: go left`
        : `${fmt(key)} > ${fmt(v(at))}: go right`;
  };

  for (const value of values) insert(value);
  s.push({
    id: 'start',
    caption: root
      ? `A binary search tree: smaller keys to the left, larger to the right (built by inserting ${values.map(fmt).join(', ')})`
      : 'An empty binary search tree',
    show: snap(),
    camera: 'overview',
  });

  const search = (key: Item, verb: string): string | undefined => {
    const p = path(key);
    for (const [k, id] of p.entries()) {
      if (s.full) break;
      const hit = cmp(key, v(id)) === 0;
      s.push({
        id: `${verb}-${fmt(key)}-${k + 1}`,
        caption: hit
          ? `${fmt(key)} = ${fmt(v(id))}: found after ${k + 1} comparison${k ? 's' : ''}`
          : step(key, id),
        show: snap({ [id]: hit ? 'found' : 'compare' }),
        pulse: [id],
      });
      if (hit) return id;
    }
    s.push({
      id: `${verb}-${fmt(key)}-miss`,
      caption: `The next spot is empty: ${fmt(key)} is not in the tree`,
      show: snap(),
    });
    return undefined;
  };
  const parentOf = (id: string) => [...tree].find(([, n]) => n.left === id || n.right === id)?.[0];
  const replace = (id: string, by: string | undefined) => {
    const parent = parentOf(id);
    if (!parent) root = by;
    else if (tree.get(parent)!.left === id) tree.get(parent)!.left = by;
    else tree.get(parent)!.right = by;
    tree.delete(id);
  };

  for (const op of ops) {
    if (s.full) break;
    if (op.op === 'insert') {
      const p = path(op.value);
      const last = p[p.length - 1];
      if (last && cmp(op.value, v(last)) === 0) {
        s.push({
          id: `insert-${fmt(op.value)}`,
          caption: `${fmt(op.value)} is already in the tree: a BST keeps keys unique`,
          show: snap({ [last]: 'found' }),
        });
        continue;
      }
      if (last) {
        const side = cmp(op.value, v(last)) < 0 ? 'left' : 'right';
        const other = side === 'left' ? 'right' : 'left';
        const distract = [
          `${other} child of ${fmt(v(last))}`,
          ...(p.length > 1 ? [`${side} child of ${fmt(v(p[p.length - 2]))}`] : []),
          `${other} child of ${fmt(v(root!))}`,
        ];
        s.quiz(
          snap(),
          `Insert ${fmt(op.value)}: where does it go?`,
          `${side} child of ${fmt(v(last))}`,
          distract,
        );
        s.push({
          id: `insert-${fmt(op.value)}-path`,
          caption: `${p.map((id) => step(op.value, id)).join(', ')}: an empty spot`,
          show: snap(Object.fromEntries(p.map((id) => [id, 'compare']))),
          pulse: p,
        });
      }
      const id = insert(op.value)!;
      s.push({
        id: `insert-${fmt(op.value)}`,
        caption: last
          ? `${fmt(op.value)} becomes the ${cmp(op.value, v(last)) < 0 ? 'left' : 'right'} child of ${fmt(v(last))}`
          : `${fmt(op.value)} becomes the root`,
        show: snap({ [id]: 'new' }),
        pulse: [id],
      });
    } else if (op.op === 'search') {
      if (!s.quizzed) {
        const p = path(op.value);
        s.quiz(
          snap(),
          `How many comparisons does searching for ${fmt(op.value)} take?`,
          String(p.length),
          [String(p.length + 1), String(Math.max(p.length - 1, 1)), String(tree.size)],
        );
      }
      search(op.value, 'search');
    } else if (op.op === 'delete') {
      const key = op.value;
      if (key === undefined) continue;
      const id = search(key, 'delete');
      if (!id || s.full) continue;
      const node = tree.get(id)!;
      if (node.left && node.right) {
        // Two children: copy the in-order successor (leftmost of the right subtree), then remove it.
        let succ = node.right;
        while (tree.get(succ)!.left) succ = tree.get(succ)!.left!;
        s.push({
          id: `delete-${fmt(key)}-successor`,
          caption: `${fmt(key)} has two children: its in-order successor is the smallest key on its right, ${fmt(v(succ))}`,
          show: snap({ [id]: 'gone', [succ]: 'found' }),
          pulse: [succ],
        });
        const succValue = v(succ);
        s.push({
          id: `delete-${fmt(key)}-copy`,
          caption: `Copy ${fmt(succValue)} into ${fmt(key)}'s place; the order is still correct`,
          show: snap({ [id]: 'new', [succ]: 'gone' }, '', { [id]: succValue }),
          pulse: [id],
        });
        s.values.set(id, succValue);
        const up = tree.get(succ)!.right;
        replace(succ, up);
        s.push({
          id: `delete-${fmt(key)}`,
          caption: up
            ? `Remove the old ${fmt(succValue)} node: its right child ${fmt(v(up))} moves up into its place`
            : `Remove the old ${fmt(succValue)} node, a leaf`,
          show: snap({ [id]: 'new' }),
        });
      } else {
        const child = node.left ?? node.right;
        s.push({
          id: `delete-${fmt(key)}-mark`,
          caption: child
            ? `${fmt(key)} has one child, ${fmt(v(child))}: it takes ${fmt(key)}'s place`
            : `${fmt(key)} is a leaf: just remove it`,
          show: snap({ [id]: 'gone', ...(child ? { [child]: 'visit' as Mark } : {}) }),
          pulse: [id],
        });
        replace(id, child);
        s.push({
          id: `delete-${fmt(key)}`,
          caption: `${fmt(key)} is gone; the tree is still a BST`,
          show: snap(child ? { [child]: 'visit' } : {}),
        });
      }
    } else if (op.op === 'traverse') {
      const how = op.order ?? 'inorder';
      const seq: string[] = [];
      const visit = (at: string | undefined) => {
        if (!at) return;
        const n = tree.get(at)!;
        if (how === 'preorder') seq.push(at);
        visit(n.left);
        if (how === 'inorder') seq.push(at);
        visit(n.right);
        if (how === 'postorder') seq.push(at);
      };
      if (how === 'level') {
        const queue = root ? [root] : [];
        while (queue.length) {
          const at = queue.shift()!;
          seq.push(at);
          const n = tree.get(at)!;
          if (n.left) queue.push(n.left);
          if (n.right) queue.push(n.right);
        }
      } else visit(root);
      const name = {
        inorder: 'In-order',
        preorder: 'Pre-order',
        postorder: 'Post-order',
        level: 'Level order',
      }[how];
      const rule = {
        inorder: 'left subtree, node, right subtree: keys come out sorted',
        preorder: 'node first, then left and right subtrees',
        postorder: 'left and right subtrees first, then the node',
        level: 'row by row from the root',
      }[how];
      const seen: string[] = [];
      seq.forEach((id, k) => {
        if (s.full) return;
        seen.push(String(fmt(v(id))));
        s.push({
          id: `${how}-${k + 1}`,
          caption:
            k === 0 ? `${name} traversal, ${rule}: visit ${fmt(v(id))}` : `Visit ${fmt(v(id))}`,
          show: snap(
            {
              ...Object.fromEntries(seq.slice(0, k).map((x) => [x, 'visit' as Mark])),
              [id]: 'found',
            },
            `${name}: ${seen.join(' ')}`,
          ),
          pulse: [id],
        });
      });
    }
  }
}

// ---------- hash table with separate chaining ----------

function hashTable(values: Item[], ops: DataOp[], m: number, s: Scene): DemoObject[] {
  const buckets: string[][] = Array.from({ length: m }, () => []);
  const v = (id: string) => s.values.get(id)!;
  const y = (i: number) => Number((((m - 1) / 2 - i) * 1.3).toFixed(3));
  const BX = -3.2;
  const snap = (marks: Marks = {}, out = '') => {
    const show: Record<string, Look> = {};
    buckets.forEach((chain, i) => {
      chain.forEach((id, j) => s.node(show, id, [BX + 2 + j * 1.9, y(i), 0], marks[id]));
      if (chain.length) s.edge(show, `bk${i}`, chain[0]);
      chain.slice(1).forEach((id, j) => s.edge(show, chain[j], id));
    });
    s.label(show, 'out', [BX + 2.9, y(0) + 1.45, 0], out || `h(k) = k mod ${m}`);
    return show;
  };
  const h = (key: Item) => {
    const { code, bucket } = hashOf(key, m);
    const text =
      typeof key === 'number'
        ? `${fmt(key)} mod ${m} = ${bucket}`
        : `(${code}) mod ${m} = ${bucket}`;
    return { bucket, text: `h(${fmt(key)}) = ${text}` };
  };
  for (const value of values) {
    const { bucket } = hashOf(value, m);
    if (!buckets[bucket].some((id) => cmp(v(id), value) === 0)) buckets[bucket].push(s.make(value));
  }
  s.push({
    id: 'start',
    caption: `A hash table with ${m} buckets. Keys that hash to the same bucket share a chain`,
    show: snap(),
    camera: 'overview',
  });

  /** Hash, then compare along the chain. Returns the chain index or -1. */
  const probe = (key: Item, verb: string): { bucket: number; k: number } => {
    const { bucket, text } = h(key);
    const chain = buckets[bucket];
    s.push({
      id: `${verb}-${fmt(key)}-hash`,
      caption: `${text}: go to bucket ${bucket}${chain.length ? '' : verb === 'insert' ? ', which is empty' : `, which is empty, so ${fmt(key)} is not stored`}`,
      show: snap({}, text),
      highlight: [`bk${bucket}`],
      pulse: [`bk${bucket}`],
    });
    if (verb === 'insert') return { bucket, k: chain.findIndex((id) => cmp(v(id), key) === 0) };
    for (let k = 0; k < chain.length && !s.full; k++) {
      const hit = cmp(v(chain[k]), key) === 0;
      s.push({
        id: `${verb}-${fmt(key)}-${k + 1}`,
        caption: hit
          ? `${fmt(v(chain[k]))} matches: found`
          : `${fmt(v(chain[k]))} is not ${fmt(key)}: next in the chain`,
        show: snap({ [chain[k]]: hit ? 'found' : 'compare' }, text),
        pulse: [chain[k]],
      });
      if (hit) return { bucket, k };
    }
    if (chain.length)
      s.push({
        id: `${verb}-${fmt(key)}-miss`,
        caption: `End of the chain: ${fmt(key)} is not stored`,
        show: snap({}, text),
      });
    return { bucket, k: -1 };
  };

  for (const op of ops) {
    if (s.full) break;
    if (op.op === 'insert') {
      const { bucket } = hashOf(op.value, m);
      s.quiz(snap(), `Which bucket does ${fmt(op.value)} land in?`, String(bucket), [
        String((bucket + 1) % m),
        String((bucket + m - 1) % m),
      ]);
      const { k, bucket: b } = probe(op.value, 'insert');
      if (k >= 0) {
        s.push({
          id: `insert-${fmt(op.value)}`,
          caption: `${fmt(op.value)} is already stored in bucket ${b}`,
          show: snap({ [buckets[b][k]]: 'found' }),
        });
        continue;
      }
      const chain = buckets[b];
      const held = chain.map((id) => fmt(v(id))).join(', ');
      const id = s.make(op.value);
      chain.push(id);
      s.push({
        id: `insert-${fmt(op.value)}`,
        caption:
          chain.length > 1
            ? `Collision: bucket ${b} already holds ${held}, so ${fmt(op.value)} is chained after them`
            : `Bucket ${b} was empty: ${fmt(op.value)} is its first entry`,
        show: snap({ [id]: 'new' }),
        pulse: [id],
      });
    } else if (op.op === 'search') {
      probe(op.value, 'search');
    } else if (op.op === 'delete') {
      if (op.value === undefined) continue;
      const { bucket, k } = probe(op.value, 'delete');
      if (k < 0) continue;
      const chain = buckets[bucket];
      const id = chain[k];
      s.push({
        id: `delete-${fmt(op.value)}-unlink`,
        caption:
          k === 0
            ? `Unlink it: bucket ${bucket} now points at ${chain[1] ? fmt(v(chain[1])) : 'nothing'}`
            : `Unlink it: ${fmt(v(chain[k - 1]))}.next skips to ${chain[k + 1] ? fmt(v(chain[k + 1])) : 'null'}`,
        show: snap({ [id]: 'gone' }),
        pulse: [id],
      });
      chain.splice(k, 1);
      s.push({
        id: `delete-${fmt(op.value)}`,
        caption: `${fmt(op.value)} is removed; the rest of the chain closes up`,
        show: snap(),
      });
    } else if (op.op === 'traverse') {
      const seen: string[] = [];
      buckets.forEach((chain) =>
        chain.forEach((id) => {
          if (s.full) return;
          seen.push(String(fmt(v(id))));
          s.push({
            id: `visit-${fmt(v(id))}`,
            caption: `Visit ${fmt(v(id))}, bucket by bucket`,
            show: snap({ [id]: 'visit' }, `visited: ${seen.join(' ')}`),
            pulse: [id],
          });
        }),
      );
    }
  }
  return Array.from(
    { length: m },
    (_, i): DemoObject => ({
      id: `bk${i}`,
      type: 'cell',
      at: [BX, y(i), 0],
      size: [1, 0.9, 0.5],
      value: `[${i}]`,
      ask: `Bucket ${i}: holds the keys whose hash is ${i}`,
    }),
  );
}

export function dataStructure(raw: DataStructureParams | Record<string, unknown> = {}): DemoSpec {
  const p = record(raw);
  const structure = oneOf(p.structure, STRUCTURES, 'linked-list');
  const m = int(p.buckets, 2, 11, 7);
  const useDefaults = p.values === undefined && p.ops === undefined;
  const values = useDefaults
    ? DEFAULTS[structure].values
    : list(p.values, 12)
        .map(item)
        .filter((x): x is Item => x !== undefined);
  const given = useDefaults ? DEFAULTS[structure].ops : normaliseOps(p.ops);
  const ops: DataOp[] = given.length ? given : [{ op: 'traverse' }];

  const s = new Scene();
  const defs: DemoObject[] = [];
  if (structure === 'linked-list') linkedList(values, ops, s);
  else if (structure === 'binary-tree') binaryTree(values, ops, s);
  else if (structure === 'hash-table') defs.push(...hashTable(values, ops, m, s));
  else linear(structure, values, ops, s);

  for (const [id, value] of s.values) {
    defs.push({ id: `q${id.slice(1)}`, type: 'box', size: [1.3, 1.2, 0.12] });
    defs.push({ id, type: 'cell', size: [1, 0.9, 0.5], ask: `Node holding ${fmt(value)}` });
  }
  for (const [id, [from, to]] of s.edges)
    defs.push({ id, type: 'arrow', from, to, color: 'neutral' });
  for (const [id] of s.labels) {
    if (id === 'out') defs.push({ id, type: 'label', ask: 'Result so far' });
    else if (id === 'head') defs.push({ id, type: 'label', ask: 'head: points at the first node' });
    else if (id === 'nil') defs.push({ id, type: 'label', ask: 'null: the end of the list' });
    else if (id === 'top')
      defs.push({ id, type: 'label', ask: 'top: the only end a stack can push to or pop from' });
  }
  const title = {
    array: 'Array operations',
    'linked-list': 'Linked list operations',
    stack: 'Stack: push and pop',
    queue: 'Queue: enqueue and dequeue',
    'binary-tree': 'Binary search tree',
    'hash-table': 'Hash table with chaining',
  }[structure];
  return framesToSpec(title, defs, s.frames);
}
