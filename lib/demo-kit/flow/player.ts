/**
 * Flow engine (story 3.3): an SVG board in a flat 2.5D style for pipelines,
 * state machines, protocols and request lifecycles. Nodes are cards with a
 * solid extrusion (no gradients, no blur); the active card lifts and takes the
 * accent; tokens ride the edges step by step with gsap.
 *
 * Reuses the kit: step states (core/timeline via flow/model), the chrome and
 * transport (core/controls), the host bridge and the theme. Like the 3D
 * player, the gsap timeline has one label per step and fromTo tweens between
 * neighbouring states, so next, back and scrub all land on a consistent picture.
 */
import gsap from 'gsap';
import { listenToHost, postToHost } from '../core/bridge';
import { Chrome, STYLES } from '../core/controls';
import { stepAt } from '../core/motion';
import { cssVariables, initialTheme, resolveColor, THEMES, type Theme, type ThemeName } from '../core/theme';
import { resolveStepIndex } from '../core/timeline';
import type { CameraTarget, DemoObject, DemoSpec } from '../core/types';
import { ICONS } from './icons';
import { FONTS, NODE, sizeFlow, wrapText, type FlowLayout, type FontRole, type Measure, type Point, type Rect } from './layout';
import { buildFlowStates, splitGraph, type FlowState } from './model';

const SVG = 'http://www.w3.org/2000/svg';
const TOKEN_H = 22;
const HOLD = 2.2;
const MAX_SCALE = 1.3;
const FOCUS_SCALE = 1.7;

export const FLOW_STYLES = `
.fl-svg{position:absolute;left:0;right:0;display:block;width:100%;touch-action:none;user-select:none;-webkit-user-select:none}
.fl-svg.is-panning{cursor:grabbing}
.fl-node,.fl-edge{cursor:pointer}
.fl-node:focus{outline:none}
.fl-node:focus-visible .fl-top{stroke:var(--dk-accent);stroke-width:2}
.fl-node:hover:not(.is-active) .fl-top{stroke:var(--dk-muted)}
.fl-edge:hover .fl-base{stroke:var(--dk-muted)}
.fl-label{font-size:${FONTS.label.size}px;font-weight:${FONTS.label.weight};letter-spacing:-.005em;fill:var(--dk-text)}
.fl-value{font-size:${FONTS.value.size}px;font-weight:${FONTS.value.weight};fill:var(--dk-muted);font-variant-numeric:tabular-nums}
.fl-elabel{font-size:${FONTS.edge.size}px;font-weight:${FONTS.edge.weight};fill:var(--dk-muted);font-variant-numeric:tabular-nums}
.fl-tlabel{font-size:${FONTS.token.size}px;font-weight:${FONTS.token.weight};font-variant-numeric:tabular-nums}
`;

// ---------- colour helpers (flat mixes, no gradients) ----------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const k = Math.min(Math.max(t, 0), 1);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Dark or white text, whichever contrasts more with the fill. */
function inkOn(fill: string): string {
  const l = luminance(fill);
  return (l + 0.05) / (0.0056 + 0.05) >= (1.05 / (l + 0.05)) ? '#111111' : '#ffffff';
}

interface Surface {
  top: string;
  side: string;
  border: string;
  edge: string;
  dots: string;
}
const SURFACES: Record<ThemeName, Surface> = {
  dark: { top: '#141414', side: '#27272a', border: '#2c2c2e', edge: '#47474d', dots: '#1d1d1f' },
  light: { top: '#ffffff', side: '#d8d8dd', border: '#e0e0e4', edge: '#b9b9c0', dots: '#e3e3e6' },
};

// ---------- geometry helpers ----------

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

interface Poly {
  points: Point[];
  cumulative: number[];
  length: number;
}
function poly(points: Point[]): Poly {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}
function pointAt(p: Poly, k: number): Point {
  if (p.points.length === 1 || p.length === 0) return p.points[0];
  const target = Math.min(Math.max(k, 0), 1) * p.length;
  let i = 1;
  while (i < p.points.length - 1 && p.cumulative[i] < target) i++;
  const span = p.cumulative[i] - p.cumulative[i - 1] || 1;
  const t = (target - p.cumulative[i - 1]) / span;
  const a = p.points[i - 1];
  const b = p.points[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface NodeView {
  object: DemoObject;
  rect: Rect;
  textMax: number;
  root: SVGGElement;
  face: SVGGElement;
  top: SVGRectElement;
  side: SVGRectElement;
  ring: SVGRectElement;
  chip?: SVGRectElement;
  icon?: SVGPathElement;
  label: SVGTextElement;
  value?: SVGTextElement;
  anim: { presence: number; active: number; pulse: number; rise: number };
  shownText: string;
}
interface EdgeView {
  object: DemoObject;
  root: SVGGElement;
  base: SVGPathElement;
  run: SVGPathElement;
  head: SVGPathElement;
  length: number;
  poly: Poly;
  labelBox?: SVGGElement;
  anim: { presence: number; active: number; draw: number };
}
interface TokenView {
  object: DemoObject;
  root: SVGGElement;
  side: SVGRectElement;
  body: SVGRectElement;
  text: SVGTextElement;
  anim: { x: number; y: number; presence: number };
  shownText: string;
  width: number;
}

export class FlowPlayer {
  private theme: Theme;
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private readonly states: FlowState[];
  private readonly chrome: Chrome;
  private readonly svg: SVGSVGElement;
  private readonly dots: SVGCircleElement;
  private readonly layout: FlowLayout;
  private readonly measure: Measure;
  private readonly nodes = new Map<string, NodeView>();
  private readonly edges = new Map<string, EdgeView>();
  private readonly tokens = new Map<string, TokenView>();
  /** Token dock point per step. */
  private docks: Record<string, Point>[] = [];
  private timeline!: gsap.core.Timeline;
  private times: number[] = [0];
  private nav: gsap.core.Tween | null = null;
  private playCall: gsap.core.Tween | null = null;
  private camTween: gsap.core.Tween | null = null;
  private intro_: gsap.core.Timeline | null = null;
  private target = 0;
  private shown = 0;
  private playing = false;
  private camera: Rect;
  private user = { zoom: 1, dx: 0, dy: 0 };
  private overview: Rect;
  private visible = true;
  private onScreen = true;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(spec: DemoSpec, host: HTMLElement) {
    this.theme = THEMES[initialTheme()];
    this.states = buildFlowStates(spec);
    this.applyCss();
    this.measure = this.measurer();
    const n = this.states.length;
    this.chrome = new Chrome(
      host,
      spec.title ?? '',
      this.states.map((_, i) => (n <= 1 ? 0 : i / (n - 1))),
      this.states.map((s) => Boolean(s.checkpoint)),
      [],
      {
        prev: () => this.learnerGoTo(this.target - 1),
        next: () => this.learnerGoTo(this.target + 1),
        togglePlay: () => (this.playing ? this.pause() : this.play()),
        scrub: (f) => this.scrub(f),
        scrubEnd: (f) => this.learnerGoTo(stepAt(this.times, f * this.timeline.duration())),
        control: () => {},
        answer: (option) => {
          const state = this.states[this.target];
          if (state.checkpoint) postToHost({ type: 'DEMO_CHECKPOINT', stepId: state.id, correct: option === state.checkpoint.answer });
        },
      },
    );
    this.svg = el('svg', { class: 'fl-svg', role: 'img', 'aria-label': spec.title ?? 'Flow diagram' });
    this.chrome.stage.appendChild(this.svg);
    const defs = el('defs', {}, this.svg);
    const pattern = el('pattern', { id: 'dk-flow-dots', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, defs);
    this.dots = el('circle', { cx: 12, cy: 12, r: 1.1 }, pattern);

    const measure = this.measure;
    const graph = splitGraph(spec.objects ?? []);
    const sized = sizeFlow(graph, this.states, measure, spec.direction === 'down' ? 'down' : 'right');
    this.layout = sized.layout;
    const b = this.layout.bounds;
    // Room for docked tokens above and the extrusion below.
    this.overview = { x: b.x - 28, y: b.y - 40, w: b.w + 56, h: b.h + 40 + 28 + NODE.depth + NODE.lift };
    this.camera = this.overview;

    el('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: 'url(#dk-flow-dots)' }, this.svg);
    const edgeLayer = el('g', { class: 'fl-edges' }, this.svg);
    const labelLayer = el('g', { class: 'fl-elabels' }, this.svg);
    const nodeLayer = el('g', { class: 'fl-nodes' }, this.svg);
    const tokenLayer = el('g', { class: 'fl-tokens' }, this.svg);
    for (const placed of this.layout.edges) {
      const object = graph.edges.find((e) => e.id === placed.id)!;
      this.edges.set(object.id, this.buildEdge(object, placed, edgeLayer, labelLayer, sized.edgeLines[object.id]));
    }
    for (const node of graph.nodes) this.nodes.set(node.id, this.buildNode(node, this.layout.nodes[node.id], sized.textMax[node.id], nodeLayer));
    for (const token of graph.tokens) this.tokens.set(token.id, this.buildToken(token, measure, tokenLayer));
    this.docks = this.states.map((state) => this.dockPoints(state));

    this.buildTimeline(0);
    this.bindResize();
    this.bindPointer();
    this.bindKeys();
    this.bindVisibility();
    listenToHost((message) => {
      if (message.type === 'SET_THEME') this.setTheme(message.theme);
      else {
        const index = resolveStepIndex(this.states, message.step);
        if (index >= 0) {
          this.pause();
          this.goTo(index);
        }
      }
    });
    this.camera = this.cameraBox(this.states[0].camera);
    this.applyView();
    this.intro();
    this.sync();
    this.render();
    postToHost({ type: 'DEMO_READY', steps: this.states.map((s) => s.id) });
  }

  // ---------- measuring and building ----------

  private measurer(): Measure {
    const ctx = document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    const cache = new Map<string, number>();
    return (text: string, role: FontRole) => {
      const key = `${role}\u0000${text}`;
      let width = cache.get(key);
      if (width === undefined) {
        const f = FONTS[role];
        if (ctx) {
          ctx.font = `${f.weight} ${f.size}px ${family}`;
          width = ctx.measureText(text).width;
        } else width = text.length * f.size * 0.56;
        cache.set(key, width);
      }
      return width;
    };
  }

  private buildNode(object: DemoObject, rect: Rect, textMax: number, layer: SVGGElement): NodeView {
    const radius = object.shape === 'pill' ? rect.h / 2 : 12;
    const root = el('g', { id: object.id, 'data-id': object.id, class: 'fl-node', tabindex: 0, role: 'button' }, layer);
    root.setAttribute('aria-label', object.ask ? `${object.label ?? object.id}: ${object.ask}` : (object.label ?? object.id));
    const side = el('rect', { x: rect.x, y: rect.y + NODE.depth, width: rect.w, height: rect.h, rx: radius }, root);
    const face = el('g', {}, root);
    const top = el('rect', { class: 'fl-top', x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: radius, 'stroke-width': 1 }, face);
    let chip: SVGRectElement | undefined;
    let icon: SVGPathElement | undefined;
    if (object.icon && ICONS[object.icon]) {
      const cy = rect.y + rect.h / 2;
      chip = el('rect', { x: rect.x + NODE.padX, y: cy - NODE.chip / 2, width: NODE.chip, height: NODE.chip, rx: 8 }, face);
      icon = el(
        'path',
        {
          d: ICONS[object.icon],
          fill: 'none',
          'stroke-width': 1.8,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          transform: `translate(${rect.x + NODE.padX + 4} ${cy - NODE.chip / 2 + 4}) scale(${20 / 24})`,
        },
        face,
      );
    }
    const label = el('text', { class: 'fl-label' }, face);
    const value = el('text', { class: 'fl-value' }, face);
    const ring = el('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: radius, fill: 'none', 'stroke-width': 2, opacity: 0 }, root);
    ring.style.transformOrigin = `${rect.x + rect.w / 2}px ${rect.y + rect.h / 2}px`;
    ring.style.transformBox = 'view-box';
    const view: NodeView = {
      object,
      rect,
      textMax,
      root,
      face,
      top,
      side,
      ring,
      chip,
      icon,
      label,
      value,
      anim: { presence: 1, active: 0, pulse: 0, rise: 0 },
      shownText: '',
    };
    return view;
  }

  private buildEdge(
    object: DemoObject,
    placed: FlowLayout['edges'][number],
    layer: SVGGElement,
    labelLayer: SVGGElement,
    lines: string[] | undefined,
  ): EdgeView {
    const root = el('g', { id: object.id, 'data-id': object.id, class: 'fl-edge' }, layer);
    el('path', { d: placed.d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke' }, root);
    const base = el('path', { class: 'fl-base', d: placed.d, fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, root);
    const run = el('path', { d: placed.d, fill: 'none', 'stroke-width': 2.6, 'stroke-linecap': 'round' }, root);
    const pts = placed.points;
    const tip = pts[pts.length - 1];
    let back = pts[pts.length - 2] ?? tip;
    for (let i = pts.length - 2; i >= 0 && Math.hypot(tip.x - pts[i].x, tip.y - pts[i].y) < 8; i--) back = pts[i];
    const len = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
    const ux = (tip.x - back.x) / len;
    const uy = (tip.y - back.y) / len;
    const bx = tip.x - ux * 9;
    const by = tip.y - uy * 9;
    const head = el(
      'path',
      { d: `M${tip.x} ${tip.y}L${bx - uy * 4.6} ${by + ux * 4.6}L${bx + uy * 4.6} ${by - ux * 4.6}Z`, 'stroke-linejoin': 'round', 'stroke-width': 1 },
      root,
    );
    const length = (run as SVGGeometryElement).getTotalLength?.() || poly(pts).length;
    run.setAttribute('stroke-dasharray', `${length} ${length}`);
    let labelBox: SVGGElement | undefined;
    if (placed.label && lines) {
      labelBox = el('g', { 'data-id': object.id, class: 'fl-edge' }, labelLayer);
      el('rect', { x: placed.label.x, y: placed.label.y, width: placed.label.w, height: placed.label.h, rx: 5, class: 'fl-lbg' }, labelBox);
      const text = el('text', { class: 'fl-elabel', 'text-anchor': 'middle' }, labelBox);
      lines.forEach((line, i) => {
        const tspan = el('tspan', { x: placed.label!.x + placed.label!.w / 2, y: placed.label!.y + 3 + FONTS.edge.line * (i + 0.5), 'dominant-baseline': 'central' }, text);
        tspan.textContent = line;
      });
    }
    return { object, root, base, run, head, length, poly: poly(pts), labelBox, anim: { presence: 1, active: 0, draw: 0 } };
  }

  private buildToken(object: DemoObject, measure: Measure, layer: SVGGElement): TokenView {
    const labels = this.states.map((s) => s.objects[object.id]?.label ?? object.label ?? '');
    const widest = Math.max(0, ...labels.map((l) => measure(l, 'token')));
    const width = widest ? Math.ceil(widest) + 18 : 14;
    const h = widest ? TOKEN_H : 14;
    const root = el('g', { id: object.id, 'data-id': object.id, class: 'fl-token', 'pointer-events': 'none' }, layer);
    const side = el('rect', { x: -width / 2, y: -h / 2 + 2.5, width, height: h, rx: h / 2 }, root);
    const body = el('rect', { x: -width / 2, y: -h / 2, width, height: h, rx: h / 2 }, root);
    const text = el('text', { class: 'fl-tlabel', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 }, root);
    return { object, root, side, body, text, anim: { x: 0, y: 0, presence: 0 }, shownText: '', width };
  }

  /** Docked tokens sit just above the top-left of their node, side by side, clear of its label. */
  private dockPoints(state: FlowState): Record<string, Point> {
    const out: Record<string, Point> = {};
    const used = new Map<string, number>();
    for (const [id, token] of this.tokens) {
      const node = state.tokens[id];
      const rect = node ? this.layout.nodes[node] : undefined;
      if (!rect) continue;
      const offset = used.get(node!) ?? 12;
      out[id] = { x: rect.x + offset + token.width / 2, y: rect.y - TOKEN_H / 2 - 5 };
      used.set(node!, offset + token.width + 6);
    }
    return out;
  }

  // ---------- timeline ----------

  private buildTimeline(time: number): void {
    this.timeline?.kill();
    const s0 = this.states[0];
    for (const [id, node] of this.nodes) {
      Object.assign(node.anim, { presence: s0.objects[id]?.visible === false ? 0 : 1, active: s0.active.includes(id) ? 1 : 0, pulse: 0 });
    }
    for (const [id, edge] of this.edges) {
      const on = s0.active.includes(id) ? 1 : 0;
      Object.assign(edge.anim, { presence: s0.objects[id]?.visible === false ? 0 : 1, active: on, draw: on });
    }
    for (const [id, token] of this.tokens) {
      const dock = this.docks[0][id];
      Object.assign(token.anim, { x: dock?.x ?? 0, y: dock?.y ?? 0, presence: dock && s0.objects[id]?.visible ? 1 : 0 });
    }
    const tl = gsap.timeline({ paused: true, onUpdate: () => this.onTick() });
    const times = [0];
    tl.addLabel('s0', 0);
    for (let i = 1; i < this.states.length; i++) {
      const start = times[i - 1];
      let end = start + 0.8;
      const at = (offset: number, duration: number) => {
        end = Math.max(end, start + offset + duration);
        return start + offset;
      };
      const prev = this.states[i - 1];
      const cur = this.states[i];
      const fromTo = (target: object, from: Record<string, number>, to: Record<string, number>, offset: number, duration: number, ease: string) => {
        tl.fromTo(target, from, { ...to, duration, ease, immediateRender: false }, at(offset, duration));
      };

      // Tokens first: their arrival times the node and edge emphasis.
      const LEAD = 0.12;
      let arrival = 0;
      const edgeRun = new Map<string, { offset: number; duration: number }>();
      for (const [id, token] of this.tokens) {
        const a = this.docks[i - 1][id];
        const b = this.docks[i][id];
        const wasOn = Boolean(a) && prev.objects[id]?.visible !== false;
        const isOn = Boolean(b) && cur.objects[id]?.visible !== false;
        const travel = cur.travels.find((t) => t.token === id);
        const edge = travel?.edge ? this.edges.get(travel.edge) : undefined;
        if (travel && b) {
          const legs: { path: Poly; duration: number; ease: string }[] = [];
          if (edge) {
            const pts = edge.poly.points;
            const run = Math.min(Math.max(edge.poly.length / 340, 0.6), 1.4);
            const speed = edge.poly.length / run || 1;
            if (wasOn) {
              const glide = poly([a!, pts[0]]);
              if (glide.length > 1) legs.push({ path: glide, duration: Math.min(0.55, (2 * glide.length) / speed), ease: 'power2.in' });
            }
            legs.push({ path: edge.poly, duration: run, ease: wasOn ? 'none' : 'power1.inOut' });
            const settle = poly([pts[pts.length - 1], b]);
            if (settle.length > 1) legs.push({ path: settle, duration: Math.min(0.55, (2 * settle.length) / speed), ease: 'power2.out' });
          } else if (wasOn) {
            const jump = poly([a!, b]);
            legs.push({ path: jump, duration: Math.min(Math.max(jump.length / 400, 0.4), 0.9), ease: 'power2.inOut' });
          }
          let offset = LEAD;
          const startPoint = legs[0]?.path.points[0] ?? b;
          fromTo(token.anim, { x: startPoint.x, y: startPoint.y }, { x: startPoint.x, y: startPoint.y }, 0, LEAD, 'none');
          if (!wasOn && isOn) fromTo(token.anim, { presence: 0 }, { presence: 1 }, LEAD, 0.3, 'power2.out');
          for (const leg of legs) {
            const proxy = { k: 0 };
            const path = leg.path;
            tl.fromTo(
              proxy,
              { k: 0 },
              {
                k: 1,
                duration: leg.duration,
                ease: leg.ease,
                immediateRender: false,
                onUpdate: () => {
                  const p = pointAt(path, proxy.k);
                  token.anim.x = p.x;
                  token.anim.y = p.y;
                },
              },
              at(offset, leg.duration),
            );
            if (edge && path === edge.poly) edgeRun.set(edge.object.id, { offset, duration: leg.duration });
            offset += leg.duration;
          }
          arrival = Math.max(arrival, offset);
        } else if (a && b && (a.x !== b.x || a.y !== b.y)) {
          fromTo(token.anim, { x: a.x, y: a.y }, { x: b.x, y: b.y }, 0.1, 0.45, 'power2.inOut');
        }
        if (wasOn && !isOn) fromTo(token.anim, { presence: 1 }, { presence: 0 }, 0, 0.3, 'power2.in');
        else if (!travel && !wasOn && isOn) {
          fromTo(token.anim, { x: b!.x, y: b!.y }, { x: b!.x, y: b!.y }, 0, 0.01, 'none');
          fromTo(token.anim, { presence: 0 }, { presence: 1 }, 0.1, 0.35, 'power2.out');
        }
      }
      const lightAt = arrival ? Math.max(arrival - 0.18, 0.1) : 0.1;

      for (const [id, node] of this.nodes) {
        const was = prev.objects[id]?.visible === false ? 0 : 1;
        const is = cur.objects[id]?.visible === false ? 0 : 1;
        if (was !== is) fromTo(node.anim, { presence: was }, { presence: is }, is ? 0.05 : 0, is ? 0.5 : 0.35, is ? 'power2.out' : 'power2.in');
        const a = prev.active.includes(id) ? 1 : 0;
        const b = cur.active.includes(id) ? 1 : 0;
        if (a !== b) fromTo(node.anim, { active: a }, { active: b }, b ? lightAt : 0, b ? 0.5 : 0.35, b ? 'back.out(2)' : 'power2.out');
        if (cur.pulse.includes(id)) fromTo(node.anim, { pulse: 0 }, { pulse: 1 }, lightAt, 0.85, 'power2.out');
      }
      for (const [id, edge] of this.edges) {
        const was = prev.objects[id]?.visible === false ? 0 : 1;
        const is = cur.objects[id]?.visible === false ? 0 : 1;
        if (was !== is) fromTo(edge.anim, { presence: was }, { presence: is }, is ? 0.1 : 0, 0.4, 'power2.out');
        const a = prev.active.includes(id) ? 1 : 0;
        const b = cur.active.includes(id) ? 1 : 0;
        const run = edgeRun.get(id);
        if (run) {
          fromTo(edge.anim, { active: a, draw: 0 }, { active: 1, draw: 0 }, 0, run.offset, 'none');
          fromTo(edge.anim, { draw: 0 }, { draw: 1 }, run.offset, run.duration, 'none');
        } else if (b && !a) {
          fromTo(edge.anim, { active: 0, draw: 0 }, { active: 1, draw: 1 }, 0.1, 0.6, 'power2.inOut');
        } else if (a && !b) {
          fromTo(edge.anim, { active: 1, draw: 1 }, { active: 0, draw: 1 }, 0, 0.35, 'power2.out');
        }
        if (cur.pulse.includes(id) && !run) fromTo(edge.anim, { draw: 0 }, { draw: 1 }, 0.1, 0.6, 'power1.inOut');
      }
      times.push(end);
      tl.addLabel(`s${i}`, end);
    }
    if (tl.duration() < times[times.length - 1]) tl.set({}, {}, times[times.length - 1]);
    this.timeline = tl;
    this.times = times;
    tl.seek(time, false);
    const duration = tl.duration() || 1;
    this.chrome.placeTicks(times.map((t) => t / duration));
  }

  /** The step whose transition the playhead is in (texts switch when a step starts, not halfway). */
  private enteringStep(): number {
    const t = this.timeline.time();
    let i = 0;
    while (i < this.times.length - 1 && t > this.times[i] + 1e-4) i++;
    return i;
  }

  private onTick(): void {
    this.shown = stepAt(this.times, this.timeline.time());
    this.sync();
    this.render();
  }

  // ---------- drawing ----------

  private sync(): void {
    if (!this.timeline) return;
    const theme = this.theme;
    const s = SURFACES[theme.name];
    const state = this.states[this.enteringStep()];
    this.dots.setAttribute('fill', s.dots);
    for (const [id, node] of this.nodes) {
      const { presence, active, pulse, rise } = node.anim;
      const os = state.objects[id];
      const color = resolveColor(theme, os?.color ?? node.object.color, '');
      node.root.setAttribute('opacity', String(presence));
      node.root.style.visibility = presence < 0.01 ? 'hidden' : '';
      node.root.setAttribute('transform', `translate(0 ${rise * 10})`);
      node.root.classList.toggle('is-active', active > 0.5);
      const lift = NODE.lift * active;
      node.face.setAttribute('transform', `translate(0 ${-lift})`);
      node.side.setAttribute('height', String(node.rect.h + lift));
      node.side.setAttribute('y', String(node.rect.y - lift + NODE.depth));
      node.top.setAttribute('fill', mix(s.top, theme.accent, active * (theme.name === 'dark' ? 0.2 : 0.09)));
      node.top.setAttribute('stroke', mix(color ? mix(s.border, color, 0.55) : s.border, theme.accent, active));
      node.top.setAttribute('stroke-width', String(1 + active * 0.75));
      node.side.setAttribute('fill', mix(color ? mix(s.side, color, 0.35) : s.side, theme.accent, active * 0.75));
      if (node.chip && node.icon) {
        const tint = color || theme.muted;
        node.chip.setAttribute('fill', mix(mix(s.top, tint, theme.name === 'dark' ? 0.2 : 0.13), theme.accent, active));
        node.icon.setAttribute('stroke', mix(color || theme.muted, theme.onAccent, active));
      }
      node.ring.setAttribute('stroke', theme.accent);
      node.ring.setAttribute('opacity', pulse > 0 && pulse < 1 ? String((1 - pulse) * 0.9) : '0');
      node.ring.style.transform = `scale(${1 + pulse * 0.14}, ${1 + pulse * 0.3})`;
      this.drawNodeText(node, os?.label ?? node.object.label ?? id, os?.value);
    }
    for (const edge of this.edges.values()) {
      const { presence, active, draw } = edge.anim;
      edge.root.setAttribute('opacity', String(presence));
      edge.root.style.visibility = presence < 0.01 ? 'hidden' : '';
      if (edge.labelBox) {
        edge.labelBox.setAttribute('opacity', String(presence));
        (edge.labelBox.firstChild as SVGRectElement).setAttribute('fill', theme.canvas);
        edge.labelBox.querySelector('text')!.style.fill = mix(theme.muted, theme.accent, active);
      }
      const color = resolveColor(theme, edge.object.color, s.edge);
      edge.base.setAttribute('stroke', color);
      edge.run.setAttribute('stroke', theme.accent);
      edge.run.setAttribute('opacity', String(active));
      edge.run.setAttribute('stroke-dashoffset', String(edge.length * (1 - draw)));
      const head = active > 0.5 && draw > 0.98 ? theme.accent : mix(color, theme.accent, active * draw);
      edge.head.setAttribute('fill', head);
      edge.head.setAttribute('stroke', head);
    }
    for (const [id, token] of this.tokens) {
      const { x, y, presence } = token.anim;
      const fill = resolveColor(theme, state.objects[id]?.color ?? token.object.color, theme.highlight);
      token.root.setAttribute('transform', `translate(${x} ${y})`);
      token.root.setAttribute('opacity', String(presence));
      token.root.style.visibility = presence < 0.01 ? 'hidden' : '';
      token.body.setAttribute('fill', fill);
      token.side.setAttribute('fill', mix(fill, '#000000', 0.38));
      token.text.style.fill = inkOn(fill);
      const text = state.objects[id]?.label ?? token.object.label ?? '';
      if (text !== token.shownText) {
        token.shownText = text;
        token.text.textContent = text;
      }
    }
  }

  private drawNodeText(node: NodeView, label: string, value: unknown): void {
    const valueText = value === undefined || value === '' ? '' : String(value);
    const key = `${label}\u0000${valueText}`;
    if (key === node.shownText) return;
    node.shownText = key;
    const measure = this.measure;
    const lines = wrapText(label, node.textMax, 'label', measure);
    const r = node.rect;
    const iconW = node.chip ? NODE.chip + NODE.chipGap : 0;
    const centered = !node.chip;
    const x = centered ? r.x + r.w / 2 : r.x + NODE.padX + iconW;
    const blockH = lines.length * FONTS.label.line + (valueText ? NODE.valueGap + FONTS.value.line : 0);
    const top = r.y + (r.h - blockH) / 2;
    node.label.setAttribute('text-anchor', centered ? 'middle' : 'start');
    node.label.replaceChildren();
    lines.forEach((line, i) => {
      const tspan = el('tspan', { x, y: top + FONTS.label.line * (i + 0.5), 'dominant-baseline': 'central' }, node.label);
      tspan.textContent = line;
    });
    if (node.value) {
      node.value.setAttribute('text-anchor', centered ? 'middle' : 'start');
      node.value.setAttribute('x', String(x));
      node.value.setAttribute('y', String(top + lines.length * FONTS.label.line + NODE.valueGap + FONTS.value.line / 2));
      node.value.setAttribute('dominant-baseline', 'central');
      let shown = valueText;
      while (shown.length > 1 && measure(shown, 'value') > node.textMax) shown = shown.slice(0, -2) + '…';
      node.value.textContent = shown;
    }
  }

  private render(): void {
    const state = this.states[this.shown];
    const duration = this.timeline.duration() || 1;
    this.chrome.render(
      {
        index: this.shown,
        count: this.states.length,
        caption: state.caption,
        progress: this.timeline.time() / duration,
        playing: this.playing,
        checkpoint: state.checkpoint,
        settled: this.shown === this.target && !this.nav?.isActive(),
        values: {},
      },
      this.reducedMotion,
    );
  }

  // ---------- navigation ----------

  private learnerGoTo(index: number): void {
    this.pause();
    if (this.goTo(index)) postToHost({ type: 'DEMO_STEP_CHANGED', step: this.states[this.target].id, index: this.target });
  }

  goTo(index: number, instant = false): boolean {
    if (index < 0 || index >= this.states.length) return false;
    const from = this.target;
    this.target = index;
    this.intro_?.progress(1).kill();
    this.intro_ = null;
    this.nav?.kill();
    const label = `s${index}`;
    if (instant || this.reducedMotion) {
      this.timeline.seek(label, false);
      this.onTick();
    } else {
      const distance = Math.abs(this.timeline.time() - this.times[index]);
      const steps = Math.abs(index - from);
      this.nav = this.timeline.tweenTo(label, {
        duration: steps <= 1 ? distance : Math.min(0.6 + 0.25 * steps, 1.8),
        ease: steps <= 1 ? 'none' : 'power2.inOut',
        onComplete: () => {
          this.nav = null;
          this.render();
        },
      });
    }
    this.moveCamera(this.states[from]?.camera, this.states[index].camera, instant);
    return true;
  }

  private scrub(fraction: number): void {
    this.pause();
    this.nav?.kill();
    this.nav = null;
    this.timeline.progress(Math.min(Math.max(fraction, 0), 1));
    this.target = this.shown;
  }

  play(): void {
    if (this.playing) return;
    if (this.target >= this.states.length - 1) this.goTo(0);
    this.playing = true;
    this.render();
    this.advance(this.target === 0 ? 0.6 : 0.1);
  }

  pause(): void {
    this.playing = false;
    this.playCall?.kill();
    this.playCall = null;
    this.render();
  }

  private advance(delay: number): void {
    this.playCall = gsap.delayedCall(delay, () => {
      if (!this.playing) return;
      const next = this.target + 1;
      if (next >= this.states.length) return this.pause();
      this.goTo(next);
      postToHost({ type: 'DEMO_STEP_CHANGED', step: this.states[next].id, index: next });
      if (this.states[next].checkpoint) return this.pause();
      this.advance(this.times[next] - (this.times[next - 1] ?? 0) + HOLD);
    });
  }

  // ---------- camera: fit, focus, pan and zoom ----------

  /** A box with the viewport's aspect around `box`, never magnified beyond `cap`. */
  private fit(box: Rect, cap: number): Rect {
    const w = this.svg.clientWidth || 1280;
    const h = this.svg.clientHeight || 560;
    const scale = Math.min(w / box.w, h / box.h, cap);
    const vw = w / scale;
    const vh = h / scale;
    return { x: box.x + box.w / 2 - vw / 2, y: box.y + box.h / 2 - vh / 2, w: vw, h: vh };
  }

  private cameraBox(camera: CameraTarget): Rect {
    const rect = typeof camera === 'string' && camera !== 'overview' ? this.layout.nodes[camera] : undefined;
    if (!rect) return this.fit(this.overview, MAX_SCALE);
    const w = Math.max(rect.w * 2.8, this.overview.w * 0.45);
    const h = Math.max(rect.h * 4, this.overview.h * 0.45);
    return this.fit({ x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h }, FOCUS_SCALE);
  }

  private applyView(): void {
    const c = this.camera;
    const w = c.w / this.user.zoom;
    const h = c.h / this.user.zoom;
    const x = c.x + c.w / 2 - w / 2 + this.user.dx;
    const y = c.y + c.h / 2 - h / 2 + this.user.dy;
    this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  private moveCamera(from: CameraTarget | undefined, to: CameraTarget, instant: boolean): void {
    const same = JSON.stringify(from ?? 'overview') === JSON.stringify(to);
    const user = this.user.zoom !== 1 || this.user.dx !== 0 || this.user.dy !== 0;
    if (same && !user) return;
    this.camTween?.kill();
    const goal = this.cameraBox(to);
    if (instant || this.reducedMotion) {
      this.user = { zoom: 1, dx: 0, dy: 0 };
      this.camera = goal;
      this.applyView();
      return;
    }
    const start = { ...this.camera };
    const userStart = { ...this.user };
    const proxy = { k: 0 };
    this.camTween = gsap.to(proxy, {
      k: 1,
      duration: 1.1,
      ease: 'power3.inOut',
      onUpdate: () => {
        const k = proxy.k;
        this.camera = {
          x: start.x + (goal.x - start.x) * k,
          y: start.y + (goal.y - start.y) * k,
          w: start.w + (goal.w - start.w) * k,
          h: start.h + (goal.h - start.h) * k,
        };
        this.user = {
          zoom: userStart.zoom + (1 - userStart.zoom) * k,
          dx: userStart.dx * (1 - k),
          dy: userStart.dy * (1 - k),
        };
        this.applyView();
      },
    });
  }

  private bindResize(): void {
    const place = () => {
      const top = (this.chrome.root.querySelector('.dk-top') as HTMLElement | null)?.offsetHeight ?? 56;
      const bar = (this.chrome.root.querySelector('.dk-bar') as HTMLElement | null)?.offsetHeight ?? 112;
      this.svg.style.top = `${top}px`;
      this.svg.style.height = `${Math.max(this.chrome.stage.clientHeight - top - bar - 4, 80)}px`;
      this.camera = this.cameraBox(this.states[this.target].camera);
      this.applyView();
    };
    const ro = new ResizeObserver(place);
    ro.observe(this.chrome.root);
    this.cleanups.push(() => ro.disconnect());
    place();
  }

  private bindPointer(): void {
    const svg = this.svg;
    let down: { x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
    const toUnits = () => {
      const vb = svg.viewBox.baseVal;
      return vb && svg.clientWidth ? vb.width / svg.clientWidth : 1;
    };
    svg.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, dx: this.user.dx, dy: this.user.dy, moved: false };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!down || !e.buttons) return;
      const mx = e.clientX - down.x;
      const my = e.clientY - down.y;
      if (!down.moved && Math.hypot(mx, my) < 5) return;
      if (!down.moved) {
        down.moved = true;
        svg.setPointerCapture?.(e.pointerId);
        svg.classList.add('is-panning');
        this.camTween?.kill();
      }
      const u = toUnits();
      this.user.dx = down.dx - mx * u;
      this.user.dy = down.dy - my * u;
      this.applyView();
    });
    const end = (e: PointerEvent) => {
      if (!down) return;
      const wasDrag = down.moved;
      down = null;
      svg.classList.remove('is-panning');
      if (wasDrag || e.type !== 'pointerup') return;
      const hit = (e.target as Element | null)?.closest?.('[data-id]');
      const id = hit?.getAttribute('data-id');
      if (id) this.ask(id);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const before = svg.viewBox.baseVal;
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const zoom = Math.min(Math.max(this.user.zoom * Math.exp(-e.deltaY * 0.0015), 0.5), 4);
        const w = this.camera.w / zoom;
        const h = this.camera.h / zoom;
        // Keep the point under the cursor fixed.
        const px = before.x + before.width * fx;
        const py = before.y + before.height * fy;
        this.user.zoom = zoom;
        this.user.dx = px - w * fx - (this.camera.x + this.camera.w / 2 - w / 2);
        this.user.dy = py - h * fy - (this.camera.y + this.camera.h / 2 - h / 2);
        this.applyView();
      },
      { passive: false },
    );
    svg.addEventListener('dblclick', () => {
      const camera = this.states[this.target].camera;
      this.moveCamera(camera, camera, false);
    });
    svg.addEventListener('keydown', (e) => {
      const id = (e.target as Element).getAttribute?.('data-id');
      if (id && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        this.ask(id);
      }
    });
  }

  private ask(id: string): void {
    const state = this.states[this.shown];
    const object = this.nodes.get(id)?.object ?? this.edges.get(id)?.object;
    if (!object) return;
    const name = (ref: unknown) => (typeof ref === 'string' ? (state.objects[ref]?.label ?? ref) : '');
    const label = state.objects[id]?.label ?? object.label ?? (object.type === 'edge' ? `${name(object.from)} → ${name(object.to)}` : id);
    postToHost({ type: 'DEMO_ASK', objectId: id, label, ask: object.ask ?? '', step: state.id });
  }

  private bindKeys(): void {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === '.') this.learnerGoTo(this.target + 1);
      else if (e.key === 'ArrowLeft' || e.key === ',') this.learnerGoTo(this.target - 1);
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        if (this.playing) this.pause();
        else this.play();
      }
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    this.cleanups.push(() => document.removeEventListener('keydown', onKey));
  }

  /** gsap's ticker drives every frame; it sleeps while the frame is hidden or scrolled away. */
  private bindVisibility(): void {
    const update = () => {
      const run = !this.disposed && this.visible && this.onScreen;
      if (run) {
        gsap.ticker.wake();
        gsap.globalTimeline.resume();
      } else {
        gsap.globalTimeline.pause();
        gsap.ticker.sleep();
      }
    };
    const onVisibility = () => {
      this.visible = document.visibilityState !== 'hidden';
      update();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    const io = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(this.chrome.stage);
    this.cleanups.push(() => io.disconnect());
    const onPageHide = () => this.dispose();
    window.addEventListener('pagehide', onPageHide);
    this.cleanups.push(() => window.removeEventListener('pagehide', onPageHide));
  }

  // ---------- theme and intro ----------

  setTheme(name: ThemeName): void {
    if (this.theme.name === name) return;
    this.theme = THEMES[name];
    document.documentElement.setAttribute('data-theme', name);
    this.applyCss();
    this.sync();
  }

  private applyCss(): void {
    let style = document.getElementById('dk-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'dk-style';
      document.head.appendChild(style);
    }
    style.textContent = `:root{${cssVariables(this.theme)}color-scheme:${this.theme.name}}${STYLES}${FLOW_STYLES}`;
  }

  /** Cards rise into place rank by rank, then the edges draw, so the first frame teaches the layout. */
  private intro(): void {
    if (this.reducedMotion) return;
    const s0 = this.states[0];
    const intro = gsap.timeline({ onUpdate: () => this.sync() });
    for (const [id, node] of this.nodes) {
      if (s0.objects[id]?.visible === false) continue;
      const delay = 0.08 + Math.min(this.layout.nodes[id].rank, 12) * 0.07;
      intro.fromTo(node.anim, { presence: 0, rise: 1 }, { presence: 1, rise: 0, duration: 0.6, ease: 'power3.out' }, delay);
    }
    for (const [id, edge] of this.edges) {
      if (s0.objects[id]?.visible === false) continue;
      const delay = 0.2 + Math.min(this.layout.nodes[edge.object.from as string]?.rank ?? 0, 12) * 0.07;
      intro.fromTo(edge.anim, { presence: 0 }, { presence: 1, duration: 0.5, ease: 'power2.out' }, delay);
    }
    this.intro_ = intro;
  }

  // ---------- test and debugging handle ----------

  api() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const player = this;
    return {
      steps: this.states.map((s) => s.id),
      goTo: (step: string | number, instant = true) => {
        const index = resolveStepIndex(this.states, step);
        return index >= 0 && this.goTo(index, instant);
      },
      setTheme: (name: ThemeName) => this.setTheme(name),
      get step() {
        return player.states[player.shown].id;
      },
      get looping() {
        return !player.disposed && player.visible && player.onScreen;
      },
      /** Layout and live positions, in SVG units. */
      inspect: () => ({
        nodes: Object.fromEntries(Object.entries(this.layout.nodes).map(([id, r]) => [id, { x: r.x, y: r.y, w: r.w, h: r.h }])),
        tokens: Object.fromEntries(
          [...this.tokens].map(([id, t]) => [id, { x: t.anim.x, y: t.anim.y, visible: t.anim.presence > 0.5, at: this.states[this.shown].tokens[id] }]),
        ),
        active: this.states[this.shown].active,
        viewBox: this.svg.getAttribute('viewBox'),
      }),
      dispose: () => this.dispose(),
    };
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timeline.kill();
    this.camTween?.kill();
    for (const cleanup of this.cleanups) cleanup();
  }
}
