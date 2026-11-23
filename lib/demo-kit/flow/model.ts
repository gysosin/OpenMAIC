/**
 * Flow step model: the core step states (core/timeline.ts buildStates: show,
 * hide, set, highlight, pulse, caption, checkpoint, camera) plus where each
 * token is. A step's `travel` moves a token along an edge (it ends on the
 * edge's target) or straight to a node; the location carries forward, like
 * every persistent verb, so going back or scrubbing just shows an earlier state.
 */
import { buildStates, type StepState } from '../core/timeline';
import type { DemoObject, DemoSpec } from '../core/types';

export interface Travel {
  token: string;
  /** Node the token starts from (null: it appears at the route's start). */
  from: string | null;
  /** Edge it rides, if any. */
  edge?: string;
  /** Node it ends on. */
  to: string;
}

export interface FlowState extends StepState {
  /** Token id -> node it sits on (null: nowhere yet). */
  tokens: Record<string, string | null>;
  travels: Travel[];
  /** Nodes and edges emphasised in this step. */
  active: string[];
}

export interface FlowGraph {
  nodes: DemoObject[];
  edges: DemoObject[];
  tokens: DemoObject[];
}

export function splitGraph(objects: DemoObject[]): FlowGraph {
  const nodes = objects.filter((o) => o.type === 'node');
  const ids = new Set(nodes.map((o) => o.id));
  return {
    nodes,
    edges: objects.filter(
      (o) => o.type === 'edge' && typeof o.from === 'string' && typeof o.to === 'string' && ids.has(o.from) && ids.has(o.to),
    ),
    tokens: objects.filter((o) => o.type === 'token'),
  };
}

export function buildFlowStates(spec: Pick<DemoSpec, 'objects' | 'steps'>): FlowState[] {
  const graph = splitGraph(spec.objects ?? []);
  const nodeIds = new Set(graph.nodes.map((o) => o.id));
  const edges = new Map(graph.edges.map((o) => [o.id, o]));
  const base = buildStates(spec);
  const steps = spec.steps?.length ? spec.steps : [{ id: 'start' }];
  let at: Record<string, string | null> = Object.fromEntries(
    graph.tokens.map((t) => [t.id, typeof t.from === 'string' && nodeIds.has(t.from) ? t.from : null]),
  );
  return base.map((state, i) => {
    at = { ...at };
    const travels: Travel[] = [];
    for (const [token, ref] of Object.entries(steps[i].travel ?? {})) {
      if (!(token in at)) continue;
      const edge = edges.get(ref);
      const to = edge ? (edge.to as string) : nodeIds.has(ref) ? ref : null;
      if (!to) continue;
      travels.push({ token, from: at[token], edge: edge?.id, to });
      at[token] = to;
    }
    const highlighted = state.highlight.filter((id) => nodeIds.has(id) || edges.has(id));
    const nodes = highlighted.some((id) => nodeIds.has(id)) ? [] : travels.map((t) => t.to);
    const active = [...new Set([...highlighted, ...nodes, ...travels.flatMap((t) => (t.edge ? [t.edge] : []))])];
    for (const [id, edge] of edges) {
      const os = state.objects[id];
      if (os && !(state.objects[edge.from as string]?.visible && state.objects[edge.to as string]?.visible)) os.visible = false;
    }
    for (const [id, node] of Object.entries(at)) {
      const os = state.objects[id];
      if (os && node === null) os.visible = false;
    }
    return { ...state, tokens: at, travels, active };
  });
}
