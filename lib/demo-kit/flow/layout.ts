/**
 * Layered layout for flow diagrams (PLAN.md C3: "small layered layout written
 * in the kit"). Pure and deterministic, so vitest can check it without a DOM.
 *
 * Sugiyama in five passes, written for graphs of up to ~60 nodes:
 * 1. break cycles (DFS from sources; an edge back onto the stack is reversed),
 * 2. rank by longest path, then pull pure sources next to their successors,
 * 3. split long edges into one dummy vertex per rank they cross,
 * 4. order each rank by barycenter sweeps, keeping the order with the fewest crossings,
 * 5. place each rank on the cross axis by isotonic regression (pool adjacent
 *    violators): every vertex as close as possible to the mean of its neighbours
 *    while keeping order and spacing, so chains come out straight and nothing overlaps.
 *
 * Edges run straight through rank columns (at a port or a dummy's height) and
 * bend only in the gaps between columns, so an edge never crosses a node.
 * Coordinates are abstract (main = rank axis, cross = within a rank) until the
 * end, so "right" and "down" share every line.
 * ponytail: O(E^2) crossing count and 24 sweeps; fine below a few hundred edges, use elkjs beyond that.
 */

import type { StepState } from '../core/timeline';
import type { DemoObject } from '../core/types';

export type Direction = 'right' | 'down';
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}
export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /** Size of the edge label box, if any. */
  label?: { w: number; h: number };
}
export interface PlacedNode extends Rect {
  rank: number;
}
export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
  /** SVG path from the source port to the target port. */
  d: string;
  /** The same path sampled as a polyline (for tokens, hit tests and tests). */
  points: Point[];
  /** Label box, top-left corner. */
  label?: Rect;
  /** Drawn against the rank order (a cycle's back edge). */
  reversed: boolean;
  loop: boolean;
}
export interface FlowLayout {
  nodes: Record<string, PlacedNode>;
  edges: PlacedEdge[];
  bounds: Rect;
}

/** Cross-axis gap between neighbours in a rank: node-node, node-dummy, dummy-dummy. */
const GAP_NN = 30;
const GAP_ND = 22;
const GAP_DD = 14;
const GAP_MAIN = 52;
/** Height a self loop reaches above its node (0.75 of its control-point rise). */
const LOOP_RISE = 34;
const LABEL_MARGIN = 20;
const PORT_STEP = 12;
const SWEEPS = 24;
const PLACE_ITERATIONS = 10;
const CURVE_SAMPLES = 14;

interface Vertex {
  /** Node index for real vertices, -1 for dummies. */
  node: number;
  rank: number;
  main: number;
  cross: number;
}

/** Isotonic regression with spacing: positions in order, each at least `sep[i]` after the previous. */
function placeInOrder(desired: number[], sep: number[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < desired.length; i++) {
    if (i > 0) acc += sep[i];
    offsets.push(acc);
  }
  // Pool adjacent violators on z = desired - offset, non-decreasing.
  const blocks: { sum: number; count: number }[] = [];
  for (let i = 0; i < desired.length; i++) {
    blocks.push({ sum: desired[i] - offsets[i], count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      a.sum += b.sum;
      a.count += b.count;
      blocks.pop();
    }
  }
  const out: number[] = [];
  for (const block of blocks) for (let k = 0; k < block.count; k++) out.push(block.sum / block.count + offsets[out.length]);
  return out;
}

function countCrossings(layers: number[][], segments: [number, number][], rankOf: number[]): number {
  const pos = new Map<number, number>();
  for (const layer of layers) layer.forEach((v, i) => pos.set(v, i));
  const byRank = new Map<number, [number, number][]>();
  for (const [a, b] of segments) {
    const list = byRank.get(rankOf[a]) ?? [];
    list.push([pos.get(a)!, pos.get(b)!]);
    byRank.set(rankOf[a], list);
  }
  let crossings = 0;
  for (const list of byRank.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a1, b1] = list[i];
        const [a2, b2] = list[j];
        if ((a1 - a2) * (b1 - b2) < 0) crossings++;
      }
    }
  }
  return crossings;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function layoutFlow(
  nodesIn: LayoutNode[],
  edgesIn: LayoutEdge[],
  direction: Direction = 'right',
): FlowLayout {
  const right = direction !== 'down';
  const n = nodesIn.length;
  const index = new Map(nodesIn.map((node, i) => [node.id, i]));
  const mainSize = (i: number) => (right ? nodesIn[i].w : nodesIn[i].h);
  const crossSize = (i: number) => (right ? nodesIn[i].h : nodesIn[i].w);
  const valid = edgesIn.filter((e) => index.has(e.from) && index.has(e.to));
  const links = valid.filter((e) => e.from !== e.to);
  const loops = valid.filter((e) => e.from === e.to);
  const src = links.map((e) => index.get(e.from)!);
  const dst = links.map((e) => index.get(e.to)!);

  // 1. Cycle breaking. Roots: nodes without incoming edges first, then the rest, in spec order.
  const outOf: number[][] = nodesIn.map(() => []);
  const inDegree = new Array<number>(n).fill(0);
  links.forEach((_, k) => {
    outOf[src[k]].push(k);
    inDegree[dst[k]]++;
  });
  const reversed = new Set<number>();
  const state = new Uint8Array(n);
  const visit = (u: number) => {
    state[u] = 1;
    for (const k of outOf[u]) {
      const v = dst[k];
      if (state[v] === 1) reversed.add(k);
      else if (state[v] === 0) visit(v);
    }
    state[u] = 2;
  };
  const roots = [...nodesIn.keys()].sort((a, b) => Number(inDegree[a] > 0) - Number(inDegree[b] > 0) || a - b);
  for (const u of roots) if (state[u] === 0) visit(u);
  const tail = links.map((_, k) => (reversed.has(k) ? dst[k] : src[k]));
  const head = links.map((_, k) => (reversed.has(k) ? src[k] : dst[k]));

  // 2. Ranks: longest path in topological order, then sources move next to their nearest successor.
  const dagOut: number[][] = nodesIn.map(() => []);
  const dagIn = new Array<number>(n).fill(0);
  links.forEach((_, k) => {
    dagOut[tail[k]].push(head[k]);
    dagIn[head[k]]++;
  });
  const pending = [...dagIn];
  const queue = [...nodesIn.keys()].filter((i) => pending[i] === 0);
  const topo: number[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    topo.push(u);
    for (const v of dagOut[u]) if (--pending[v] === 0) queue.push(v);
  }
  const rank = new Array<number>(n).fill(0);
  for (const u of topo) for (const v of dagOut[u]) rank[v] = Math.max(rank[v], rank[u] + 1);
  for (const u of [...topo].reverse()) {
    if (dagIn[u] === 0 && dagOut[u].length) rank[u] = Math.min(...dagOut[u].map((v) => rank[v])) - 1;
  }
  const maxRank = Math.max(0, ...rank);

  // 3. Dummy vertices: one per rank a long edge passes through.
  const verts: Vertex[] = nodesIn.map((_, i) => ({ node: i, rank: rank[i], main: mainSize(i), cross: crossSize(i) }));
  const chains: number[][] = links.map((_, k) => {
    const chain = [tail[k]];
    for (let r = rank[tail[k]] + 1; r < rank[head[k]]; r++) {
      verts.push({ node: -1, rank: r, main: 0, cross: 0 });
      chain.push(verts.length - 1);
    }
    chain.push(head[k]);
    return chain;
  });
  const rankOf = verts.map((v) => v.rank);
  const segments: [number, number][] = [];
  const up: number[][] = verts.map(() => []);
  const down: number[][] = verts.map(() => []);
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      segments.push([chain[i], chain[i + 1]]);
      down[chain[i]].push(chain[i + 1]);
      up[chain[i + 1]].push(chain[i]);
    }
  }

  // 4. Order within ranks.
  let layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  verts.forEach((v, i) => layers[v.rank].push(i));
  let best = layers.map((l) => [...l]);
  let bestCrossings = countCrossings(layers, segments, rankOf);
  for (let sweep = 0; sweep < SWEEPS && bestCrossings > 0; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
    for (const r of order) {
      const ref = layers[downward ? r - 1 : r + 1];
      const pos = new Map(ref.map((v, i) => [v, i]));
      const keyed = layers[r].map((v, i) => {
        const near = (downward ? up[v] : down[v]).map((w) => pos.get(w)!);
        const bary = near.length ? near.reduce((a, b) => a + b, 0) / near.length : i;
        return { v, bary, i };
      });
      keyed.sort((a, b) => a.bary - b.bary || a.i - b.i);
      layers[r] = keyed.map((k) => k.v);
    }
    const crossings = countCrossings(layers, segments, rankOf);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = layers.map((l) => [...l]);
    }
  }
  layers = best;

  // 5. Cross-axis placement.
  // Left to right, a self loop rises above its node, so the node above keeps clear of it.
  const loopRoom = new Map<number, number>();
  if (right) for (const e of loops) loopRoom.set(index.get(e.from)!, LOOP_RISE + (e.label ? e.label.h + 4 : 0));
  const gap = (a: number, b: number) => {
    const dummies = Number(verts[a].node < 0) + Number(verts[b].node < 0);
    const base = dummies === 0 ? GAP_NN : dummies === 1 ? GAP_ND : GAP_DD;
    return (verts[a].cross + verts[b].cross) / 2 + base + (verts[b].node >= 0 ? (loopRoom.get(verts[b].node) ?? 0) : 0);
  };
  const cross = new Array<number>(verts.length).fill(0);
  for (const layer of layers) {
    let at = 0;
    layer.forEach((v, i) => {
      if (i > 0) at += gap(layer[i - 1], v);
      cross[v] = at;
    });
    for (const v of layer) cross[v] -= at / 2;
  }
  for (let iter = 0; iter < PLACE_ITERATIONS; iter++) {
    const order = iter % 2 === 0 ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const r of order) {
      const layer = layers[r];
      const desired = layer.map((v) => {
        const near = [...up[v], ...down[v]];
        return near.length ? near.reduce((a, w) => a + cross[w], 0) / near.length : cross[v];
      });
      const placed = placeInOrder(
        desired,
        layer.map((v, i) => (i === 0 ? 0 : gap(layer[i - 1], v))),
      );
      layer.forEach((v, i) => (cross[v] = placed[i]));
    }
  }

  // Main axis: columns as wide as their widest node, gaps wide enough for the labels in them.
  const columnMain = layers.map((layer) => Math.max(0, ...layer.map((v) => verts[v].main)));
  const labelGap = (k: number) => (reversed.has(k) ? rank[src[k]] - 1 : rank[src[k]]);
  const gapMain = new Array<number>(maxRank).fill(GAP_MAIN);
  links.forEach((e, k) => {
    const g = labelGap(k);
    if (e.label && g >= 0 && g < maxRank) {
      gapMain[g] = Math.max(gapMain[g], (right ? e.label.w : e.label.h) + LABEL_MARGIN * 2);
    }
  });
  const colStart: number[] = [];
  let mainAt = 0;
  for (let r = 0; r <= maxRank; r++) {
    colStart.push(mainAt);
    mainAt += columnMain[r] + (gapMain[r] ?? 0);
  }
  const colEnd = colStart.map((s, r) => s + columnMain[r]);
  const nodeMainStart = (i: number) => colStart[rank[i]] + (columnMain[rank[i]] - mainSize(i)) / 2;

  // Ports: edges on one side of a node spread out in the order of their other ends.
  const portOffset = new Map<string, number>();
  const sides = new Map<string, { k: number; key: number }[]>();
  chains.forEach((chain, k) => {
    const first = `${chain[0]}:out`;
    const last = `${chain[chain.length - 1]}:in`;
    sides.set(first, [...(sides.get(first) ?? []), { k, key: cross[chain[1]] }]);
    sides.set(last, [...(sides.get(last) ?? []), { k, key: cross[chain[chain.length - 2]] }]);
  });
  for (const [side, list] of sides) {
    const node = Number(side.split(':')[0]);
    list.sort((a, b) => a.key - b.key || a.k - b.k);
    const step = list.length > 1 ? Math.min(PORT_STEP, (crossSize(node) - 16) / (list.length - 1)) : 0;
    list.forEach((item, i) => portOffset.set(`${side}:${item.k}`, (i - (list.length - 1) / 2) * step));
  }

  const toXY = (m: number, c: number): Point => (right ? { x: m, y: c } : { x: c, y: m });
  const edgeOut: PlacedEdge[] = [];
  links.forEach((e, k) => {
    const chain = chains[k];
    const s = chain[0];
    const t = chain[chain.length - 1];
    const ps = cross[s] + (portOffset.get(`${s}:out:${k}`) ?? 0);
    const pt = cross[t] + (portOffset.get(`${t}:in:${k}`) ?? 0);
    let abstract: [number, number][] = [
      [nodeMainStart(s) + mainSize(s), ps],
      [colEnd[rank[s]], ps],
    ];
    for (const d of chain.slice(1, -1)) abstract.push([colStart[verts[d].rank], cross[d]], [colEnd[verts[d].rank], cross[d]]);
    abstract.push([colStart[rank[t]], pt], [nodeMainStart(t), pt]);
    abstract = abstract.filter((p, i) => i === 0 || p[0] !== abstract[i - 1][0] || p[1] !== abstract[i - 1][1]);

    let label: Rect | undefined;
    if (e.label) {
      const g = labelGap(k);
      const i = abstract.findIndex((p, j) => j + 1 < abstract.length && p[0] === colEnd[g] && abstract[j + 1][0] === colStart[g + 1]);
      const [m1, c1] = abstract[Math.max(i, 0)];
      const [m2, c2] = abstract[Math.max(i, 0) + 1] ?? abstract[Math.max(i, 0)];
      const center = toXY((m1 + m2) / 2, (c1 + c2) / 2);
      label = { x: center.x - e.label.w / 2, y: center.y - e.label.h / 2, w: e.label.w, h: e.label.h };
    }
    if (reversed.has(k)) abstract.reverse();

    const pts = abstract.map(([m, c]) => toXY(round(m), round(c)));
    let d = `M${pts[0].x} ${pts[0].y}`;
    const points: Point[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = abstract[i - 1];
      const b = abstract[i];
      if (a[1] === b[1]) {
        d += `L${pts[i].x} ${pts[i].y}`;
        points.push(pts[i]);
        continue;
      }
      const mid = (a[0] + b[0]) / 2;
      const c1 = toXY(round(mid), round(a[1]));
      const c2 = toXY(round(mid), round(b[1]));
      d += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${pts[i].x} ${pts[i].y}`;
      for (let j = 1; j <= CURVE_SAMPLES; j++) {
        const t = j / CURVE_SAMPLES;
        points.push({
          x: round(cubic(pts[i - 1].x, c1.x, c2.x, pts[i].x, t)),
          y: round(cubic(pts[i - 1].y, c1.y, c2.y, pts[i].y, t)),
        });
      }
    }
    edgeOut.push({ id: e.id, from: e.from, to: e.to, d, points, label, reversed: reversed.has(k), loop: false });
  });

  // Node rectangles.
  const nodes: Record<string, PlacedNode> = {};
  nodesIn.forEach((node, i) => {
    const corner = toXY(nodeMainStart(i), cross[i] - crossSize(i) / 2);
    nodes[node.id] = { x: round(corner.x), y: round(corner.y), w: node.w, h: node.h, rank: rank[i] };
  });

  // Self loops sit on the top-right corner (the token dock is top-left).
  for (const e of loops) {
    const r = nodes[e.from];
    const s = { x: r.x + r.w - 16, y: r.y };
    const t = { x: r.x + r.w - 46, y: r.y };
    const c1 = { x: s.x + 22, y: s.y - 42 };
    const c2 = { x: t.x - 10, y: t.y - 42 };
    const points: Point[] = [s];
    for (let j = 1; j <= CURVE_SAMPLES; j++) {
      const tt = j / CURVE_SAMPLES;
      points.push({ x: round(cubic(s.x, c1.x, c2.x, t.x, tt)), y: round(cubic(s.y, c1.y, c2.y, t.y, tt)) });
    }
    const label = e.label
      ? { x: (s.x + t.x) / 2 - e.label.w / 2 + 8, y: r.y - 34 - e.label.h, w: e.label.w, h: e.label.h }
      : undefined;
    edgeOut.push({
      id: e.id,
      from: e.from,
      to: e.to,
      d: `M${s.x} ${s.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`,
      points,
      label,
      reversed: false,
      loop: true,
    });
  }

  // Labels in one gap that collide are pushed apart along the gap.
  const byGap = new Map<string, Rect[]>();
  for (const e of edgeOut) {
    if (!e.label) continue;
    const key = right ? String(Math.round(e.label.x + e.label.w / 2)) : String(Math.round(e.label.y + e.label.h / 2));
    byGap.set(key, [...(byGap.get(key) ?? []), e.label]);
  }
  for (const list of byGap.values()) {
    const c = (l: Rect) => (right ? l.y + l.h / 2 : l.x + l.w / 2);
    const size = (l: Rect) => (right ? l.h : l.w);
    list.sort((a, b) => c(a) - c(b));
    const placed = placeInOrder(
      list.map(c),
      list.map((l, i) => (i === 0 ? 0 : (size(list[i - 1]) + size(l)) / 2 + 6)),
    );
    list.forEach((l, i) => {
      if (right) l.y = round(placed[i] - l.h / 2);
      else l.x = round(placed[i] - l.w / 2);
    });
  }

  // Bounds over nodes, labels and paths.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, w = 0, h = 0) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const r of Object.values(nodes)) grow(r.x, r.y, r.w, r.h);
  for (const e of edgeOut) {
    for (const p of e.points) grow(p.x, p.y);
    if (e.label) grow(e.label.x, e.label.y, e.label.w, e.label.h);
  }
  if (!Number.isFinite(x0)) grow(0, 0, 1, 1);
  return { nodes, edges: edgeOut, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

// ---------- text ----------

export type Measure = (text: string, font: FontRole) => number;
export type FontRole = 'label' | 'value' | 'edge' | 'token';

/** Font sizes per role; the player measures with these and the SVG draws with them. */
export const FONTS: Record<FontRole, { size: number; weight: number; line: number }> = {
  label: { size: 14, weight: 600, line: 18 },
  value: { size: 12.5, weight: 500, line: 16 },
  edge: { size: 12, weight: 500, line: 15 },
  token: { size: 12, weight: 600, line: 15 },
};

/** Width estimate for tests and non-DOM use: per-character classes of a sans face. */
export const estimateWidth: Measure = (text, font) => {
  let units = 0;
  for (const ch of text) {
    if (/[iljtf.,:;'!|()\[\] ]/.test(ch)) units += 0.32;
    else if (/[mwMW@%]/.test(ch)) units += 0.86;
    else if (/[A-Z0-9#&]/.test(ch)) units += 0.66;
    else units += 0.56;
  }
  return units * FONTS[font].size * (FONTS[font].weight >= 600 ? 1.04 : 1);
};

/** Greedy word wrap to `max` px; long words break by character; extra lines end in an ellipsis. */
export function wrapText(text: string, max: number, font: FontRole, measure: Measure, maxLines = 3): string[] {
  const lines: string[] = [];
  let line = '';
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= max) {
      line = next;
      return;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (measure(rest, font) > max) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), font) > max) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of text.trim().split(/\s+/)) if (word) push(word);
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`, font) > max) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// ---------- sizing ----------

/** Node card metrics; depth is the extrusion under a card, lift how far an active card rises. */
export const NODE = { padX: 14, padY: 12, chip: 28, chipGap: 10, minW: 112, maxW: 200, minH: 48, valueGap: 3, depth: 6, lift: 3 };
export const EDGE_LABEL_MAX = 132;

export interface SizedFlow {
  layout: FlowLayout;
  /** Wrap width of each node's label. */
  textMax: Record<string, number>;
  /** Wrapped edge labels. */
  edgeLines: Record<string, string[]>;
}

/**
 * Sizes every card from all the labels and values it shows across the steps
 * (so the layout never moves while stepping), sizes the edge labels, then lays out.
 */
export function sizeFlow(
  graph: { nodes: DemoObject[]; edges: DemoObject[] },
  states: Pick<StepState, 'objects'>[],
  measure: Measure,
  direction: Direction = 'right',
): SizedFlow {
  const textMax: Record<string, number> = {};
  const nodes = graph.nodes.map((node) => {
    const padX = NODE.padX + (node.shape === 'pill' ? 6 : 0);
    const iconW = node.icon ? NODE.chip + NODE.chipGap : 0;
    const max = NODE.maxW - padX * 2 - iconW;
    const labels = new Set<string>();
    const values = new Set<string>();
    for (const state of states) {
      const os = state.objects[node.id];
      labels.add(os?.label ?? node.label ?? node.id);
      if (os?.value !== undefined && os.value !== '') values.add(String(os.value));
    }
    if (!states.length) labels.add(node.label ?? node.id);
    let lines = 1;
    let textW = 0;
    for (const label of labels) {
      const wrapped = wrapText(label, max, 'label', measure);
      lines = Math.max(lines, wrapped.length);
      for (const line of wrapped) textW = Math.max(textW, measure(line, 'label'));
    }
    for (const value of values) textW = Math.max(textW, Math.min(measure(value, 'value'), max));
    const w = Math.ceil(Math.min(NODE.maxW, Math.max(NODE.minW, textW + padX * 2 + iconW)));
    const textH = lines * FONTS.label.line + (values.size ? NODE.valueGap + FONTS.value.line : 0);
    const h = Math.ceil(Math.max(NODE.minH, textH + NODE.padY * 2));
    textMax[node.id] = Math.min(max, w - padX * 2 - iconW) + 1;
    return { id: node.id, w, h };
  });
  const edgeLines: Record<string, string[]> = {};
  const edges = graph.edges.map((e) => {
    let label: { w: number; h: number } | undefined;
    if (e.label) {
      const lines = wrapText(e.label, EDGE_LABEL_MAX, 'edge', measure, 2);
      edgeLines[e.id] = lines;
      label = { w: Math.ceil(Math.max(...lines.map((l) => measure(l, 'edge')))) + 12, h: lines.length * FONTS.edge.line + 6 };
    }
    return { id: e.id, from: e.from as string, to: e.to as string, label };
  });
  return { layout: layoutFlow(nodes, edges, direction), textMax, edgeLines };
}
