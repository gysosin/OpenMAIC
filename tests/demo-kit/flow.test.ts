import { describe, expect, it } from 'vitest';

import { CPU_FSM, HTTP_LIFECYCLE, stressFlow } from '@/app/sandbox-lab/demo-kit/fixtures';
import { estimateWidth, sizeFlow, wrapText, type Direction, type FlowLayout, type Rect } from '@/lib/demo-kit/flow/layout';
import { buildFlowStates, splitGraph } from '@/lib/demo-kit/flow/model';
import type { DemoSpec } from '@/lib/demo-kit/core/types';

const pipeline: DemoSpec = {
  version: 1,
  kind: 'flow',
  title: 'Five',
  objects: [
    ...['Source', 'Parse', 'Transform', 'Validate', 'Sink'].map((label, i) => ({ id: `p${i}`, type: 'node' as const, label })),
    ...[0, 1, 2, 3].map((i) => ({ id: `q${i}`, type: 'edge' as const, from: `p${i}`, to: `p${i + 1}`, label: 'rows' })),
  ],
  steps: [{ id: 'one' }],
};

const lay = (spec: DemoSpec, direction: Direction = 'right') =>
  sizeFlow(splitGraph(spec.objects ?? []), buildFlowStates(spec), estimateWidth, direction).layout;

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function expectClean(layout: FlowLayout) {
  const nodes = Object.entries(layout.nodes);
  // No two cards touch (12 px clearance covers the extrusion and the active lift).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      expect(overlaps(nodes[i][1], nodes[j][1], 12), `${nodes[i][0]} / ${nodes[j][0]}`).toBe(false);
    }
  }
  for (const edge of layout.edges) {
    // An edge never passes through a card (its own ends touch the border only).
    for (const p of edge.points) {
      for (const [id, r] of nodes) {
        const inside = p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1;
        expect(inside, `${edge.id} crosses ${id}`).toBe(false);
      }
    }
    if (!edge.label) continue;
    for (const [id, r] of nodes) expect(overlaps(edge.label, r), `label ${edge.id} on ${id}`).toBe(false);
  }
  const labels = layout.edges.filter((e) => e.label);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      expect(overlaps(labels[i].label!, labels[j].label!), `${labels[i].id} / ${labels[j].id}`).toBe(false);
    }
  }
}

describe('flow layout', () => {
  it.each([
    ['5-node pipeline', pipeline, 5],
    ['12-node CPU state machine', CPU_FSM, 12],
    ['HTTP lifecycle', HTTP_LIFECYCLE, 7],
    ['30-node stress graph', stressFlow(30), 30],
  ] as const)('lays out the %s without overlaps, left to right and top down', (_name, spec, count) => {
    for (const direction of ['right', 'down'] as const) {
      const layout = lay(spec, direction);
      expect(Object.keys(layout.nodes)).toHaveLength(count);
      expectClean(layout);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(lay(stressFlow(30)))).toBe(JSON.stringify(lay(stressFlow(30))));
    expect(lay(CPU_FSM)).toEqual(lay(CPU_FSM));
  });

  it('puts a chain in rank order on one line, and a back edge against it', () => {
    const layout = lay(pipeline);
    const ys = [0, 1, 2, 3, 4].map((i) => layout.nodes[`p${i}`].y + layout.nodes[`p${i}`].h / 2);
    expect(new Set(ys).size).toBe(1);
    const xs = [0, 1, 2, 3, 4].map((i) => layout.nodes[`p${i}`].x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const http = lay(HTTP_LIFECYCLE);
    expect(http.edges.find((e) => e.id === 'e8')!.reversed).toBe(true);
    expect(http.edges.find((e) => e.id === 'e1')!.reversed).toBe(false);
  });

  it('keeps a pair of opposite edges apart', () => {
    const http = lay(HTTP_LIFECYCLE);
    const there = http.edges.find((e) => e.id === 'e5')!.points;
    const back = http.edges.find((e) => e.id === 'e6')!.points;
    expect(Math.abs(there[0].y - back[back.length - 1].y)).toBeGreaterThanOrEqual(8);
  });

  it('fits the fixtures in a 1280 x 720 frame at a readable scale', () => {
    // Stage area under the title and above the caption and transport.
    for (const spec of [HTTP_LIFECYCLE, CPU_FSM]) {
      const { w, h } = lay(spec).bounds;
      expect(Math.min(1236 / (w + 56), 540 / (h + 70)), `${spec.title}: ${w} x ${h}`).toBeGreaterThan(0.85);
    }
  });
});

describe('flow text', () => {
  it('wraps long labels into lines that fit, ellipsising past three', () => {
    const lines = wrapText('Stage 3 with a deliberately long name', 150, 'label', estimateWidth);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(estimateWidth(line, 'label')).toBeLessThanOrEqual(150);
    const many = wrapText('one two three four five six seven eight nine ten eleven twelve', 60, 'label', estimateWidth);
    expect(many).toHaveLength(3);
    expect(many[2].endsWith('…')).toBe(true);
    const word = wrapText('Supercalifragilisticexpialidocious', 80, 'label', estimateWidth);
    for (const line of word) expect(estimateWidth(line, 'label')).toBeLessThanOrEqual(80);
  });

  it('grows a card for a wrapped label instead of overflowing it', () => {
    const sized = sizeFlow(splitGraph(HTTP_LIFECYCLE.objects!), buildFlowStates(HTTP_LIFECYCLE), estimateWidth);
    const response = sized.layout.nodes.response;
    const browser = sized.layout.nodes.browser;
    expect(response.h).toBeGreaterThan(browser.h);
    expect(response.w).toBeLessThanOrEqual(200);
  });
});

describe('flow steps', () => {
  it('moves the token one edge per step and keeps it across steps without travel', () => {
    const states = buildFlowStates(HTTP_LIFECYCLE);
    expect(states.map((s) => s.tokens.pkt)).toEqual([
      'browser', 'dns', 'tcp', 'tls', 'server', 'db', 'server', 'server', 'response', 'browser',
    ]);
    expect(states.map((s) => s.travels.map((t) => t.edge))).toEqual([
      [], ['e1'], ['e2'], ['e3'], ['e4'], ['e5'], ['e6'], [], ['e7'], ['e8'],
    ]);
    expect(states[2].travels[0]).toEqual({ token: 'pkt', from: 'dns', edge: 'e2', to: 'tcp' });
  });

  it('emphasises the travelled edge and its target unless the step highlights something itself', () => {
    const states = buildFlowStates(HTTP_LIFECYCLE);
    expect(states[0].active).toEqual(['browser']);
    expect(states[1].active.sort()).toEqual(['dns', 'e1']);
    expect(states[7].active).toEqual(['tls']);
    const cpu = buildFlowStates(CPU_FSM);
    expect(cpu[cpu.length - 1].active.sort()).toEqual(['fetch', 'irq', 't11', 't14'].sort());
  });

  it('carries labels and values forward, so any step is the same however you reach it', () => {
    const full = buildFlowStates(HTTP_LIFECYCLE);
    full.forEach((state, i) => {
      const prefix = buildFlowStates({ ...HTTP_LIFECYCLE, steps: HTTP_LIFECYCLE.steps!.slice(0, i + 1) });
      expect(prefix[i]).toEqual(state);
    });
    expect(full[4].objects.pkt.label).toBe('GET /');
    expect(full[9].objects.dns.value).toBe('93.184.216.34');
  });

  it('hides tokens with no place yet and edges whose ends are hidden', () => {
    const spec: DemoSpec = {
      version: 1,
      kind: 'flow',
      objects: [
        { id: 'a', type: 'node' },
        { id: 'b', type: 'node', hidden: true },
        { id: 'ab', type: 'edge', from: 'a', to: 'b' },
        { id: 't', type: 'token' },
      ],
      steps: [{ id: 's1' }, { id: 's2', show: ['b'], travel: { t: 'ab' } }, { id: 's3', travel: { t: 'a' } }],
    };
    const [s1, s2, s3] = buildFlowStates(spec);
    expect(s1.objects.t.visible).toBe(false);
    expect(s1.objects.ab.visible).toBe(false);
    expect(s2.objects.ab.visible).toBe(true);
    expect(s2.tokens.t).toBe('b');
    expect(s2.travels[0].from).toBeNull();
    expect(s3.tokens.t).toBe('a');
    expect(s3.travels[0].edge).toBeUndefined();
  });

  it('walks the stress graph token along real edges', () => {
    const spec = stressFlow(30);
    const states = buildFlowStates(spec);
    expect(states.length).toBeGreaterThan(3);
    for (const state of states.slice(1)) {
      const edge = spec.objects!.find((o) => o.id === state.travels[0].edge)!;
      expect(edge.to).toBe(state.tokens.tok);
    }
  });
});
