/**
 * Demo kit entry: reads `<script type="application/json" id="demo-spec">`,
 * builds the stage, the step timeline and the chrome, and talks to the host
 * through the message bridge. Bundled by scripts/build-demo-kit.mjs into
 * public/vendor/interactive/demo-kit@1/demo-kit.js.
 */
import gsap from 'gsap';
import * as THREE from 'three';
import { listenToHost, postToHost } from './bridge';
import { Chrome, STYLES } from './controls';
import { buildTimeline, setAnims, stepAt, type BuiltTimeline } from './motion';
import { bodyColor, buildPrimitive, disposePrimitive, gatePorts, syncPrimitive, type Built } from './primitives';
import { Stage, type Pose } from './stage';
import { cssVariables, initialTheme, THEMES, type Theme, type ThemeName } from './theme';
import { buildStates, isVec3, resolveStepIndex, withOverrides, type ObjectState, type StepState } from './timeline';
import type { CameraTarget, DemoObject, DemoSpec, PrimitiveType, Scalar, Vec3 } from './types';

const TYPES = new Set<PrimitiveType>([
  'box', 'sphere', 'cylinder', 'plane', 'arrow', 'wire', 'label', 'grid', 'group', 'cell', 'gate', 'surface',
]);
const MAX_OBJECTS = 400;
/** Hold on each step while playing, after its motion ends. */
const HOLD = 2.2;

function readSpec(): DemoSpec | null {
  const node = document.getElementById('demo-spec');
  if (!node?.textContent) return null;
  try {
    const spec = JSON.parse(node.textContent) as DemoSpec;
    if (!spec || spec.version !== 1) return null;
    // The server validates with zod; this keeps a hand-edited spec from crashing the stage.
    const seen = new Set<string>();
    spec.objects = (Array.isArray(spec.objects) ? spec.objects : [])
      .filter((o) => o && typeof o.id === 'string' && TYPES.has(o.type) && !seen.has(o.id) && seen.add(o.id))
      .slice(0, MAX_OBJECTS);
    spec.steps = (Array.isArray(spec.steps) ? spec.steps : []).filter((s) => s && typeof s.id === 'string');
    spec.controls = (Array.isArray(spec.controls) ? spec.controls : []).filter(
      (c) => c && typeof c.bind === 'string' && (c.type === 'toggle' || c.type === 'slider'),
    );
    return spec;
  } catch {
    return null;
  }
}

class DemoPlayer {
  private theme: Theme;
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private readonly objects: DemoObject[];
  private readonly states: StepState[];
  private readonly builts = new Map<string, Built>();
  private readonly stage: Stage;
  private readonly chrome: Chrome;
  private motion!: BuiltTimeline;
  private nav: gsap.core.Tween | null = null;
  private cameraTween: gsap.core.Tween | null = null;
  private playCall: gsap.core.Tween | null = null;
  private target = 0;
  private shown = 0;
  private playing = false;
  private overrides: Record<string, Scalar> = {};
  private overrideObjects: Record<string, ObjectState> | null = null;
  private overviewBox = new THREE.Box3();
  private introTweens: gsap.core.Tween[] = [];
  /** Input port slots per gate: wire id -> slot index, count. */
  private readonly slots = new Map<string, { index: number; count: number }>();

  constructor(private readonly spec: DemoSpec, host: HTMLElement) {
    this.theme = THEMES[initialTheme()];
    this.objects = spec.objects ?? [];
    this.states = buildStates(spec);
    this.applyCss();

    const fractions = this.provisionalFractions();
    this.chrome = new Chrome(
      host,
      spec.title ?? '',
      fractions,
      this.states.map((s) => Boolean(s.checkpoint)),
      spec.controls ?? [],
      {
        prev: () => this.learnerGoTo(this.target - 1),
        next: () => this.learnerGoTo(this.target + 1),
        togglePlay: () => (this.playing ? this.pause() : this.play()),
        scrub: (f) => this.scrub(f),
        scrubEnd: (f) => this.learnerGoTo(stepAt(this.motion.times, f * this.motion.timeline.duration())),
        control: (bind, value) => this.setControl(bind, value),
        answer: (option) => {
          const state = this.states[this.target];
          if (state.checkpoint) {
            postToHost({ type: 'DEMO_CHECKPOINT', stepId: state.id, correct: option === state.checkpoint.answer });
          }
        },
      },
    );
    this.stage = new Stage(this.chrome.stage);
    this.stage.applyTheme(this.theme);
    this.buildScene();
    this.rebuildTimeline(0);
    this.stage.beforeRender = () => this.syncAll();
    this.stage.setPose(this.poseFor(this.states[0].camera));
    this.bindPointer();
    this.bindKeys();
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
    this.intro();
    this.render();
    postToHost({ type: 'DEMO_READY', steps: this.states.map((s) => s.id) });
  }

  // ---------- scene ----------

  private buildScene(): void {
    for (const object of this.objects) this.builts.set(object.id, buildPrimitive(object, this.theme));
    for (const built of this.builts.values()) {
      const parentId = built.object.parent;
      const parent = parentId ? this.builts.get(parentId) : undefined;
      if (parent && parent.object.type === 'group' && built.object.type !== 'wire') parent.root.add(built.root);
      else this.stage.scene.add(built.root);
    }
    const incoming = new Map<string, DemoObject[]>();
    for (const wire of this.objects.filter((o) => o.type === 'wire' && typeof o.to === 'string')) {
      incoming.set(wire.to as string, [...(incoming.get(wire.to as string) ?? []), wire]);
    }
    for (const wires of incoming.values()) {
      // Top input first: sort by the source's height so wires do not cross at the port.
      const sorted = [...wires].sort((a, b) => this.sourceY(b) - this.sourceY(a));
      sorted.forEach((wire, index) => this.slots.set(wire.id, { index, count: wires.length }));
    }
    setAnims(this.builts, this.states[0], this.theme);
    this.syncAll(this.states[0].objects);
    this.stage.scene.updateMatrixWorld(true);
    // Overview bounds cover every object at every step, so the framing never jumps.
    const box = new THREE.Box3();
    for (const built of this.builts.values()) {
      if (built.object.type === 'grid') continue;
      const own = new THREE.Box3().setFromObject(built.path ? built.path.mesh : built.root);
      if (built.object.type === 'label') {
        own.setFromCenterAndSize(built.root.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1.6, 0.5, 0.1));
      }
      if (own.isEmpty()) continue;
      box.union(own);
      if (built.path) continue;
      const now = built.root.position;
      for (const state of this.states) {
        const os = state.objects[built.object.id];
        if (os) box.union(own.clone().translate(new THREE.Vector3(...os.at).sub(now)));
      }
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.overviewBox = box;
    this.stage.setBounds(box);
  }

  private sourceY(wire: DemoObject): number {
    const from = wire.from;
    if (isVec3(from)) return from[1];
    const object = this.objects.find((o) => o.id === from);
    return isVec3(object?.at) ? object.at[1] : 0;
  }

  /** World position of a wire/arrow endpoint: an object's output or input port, or a point. */
  private endpoint = (ref: string | Vec3 | undefined, side: 'out' | 'in', path: Built): THREE.Vector3 | null => {
    if (isVec3(ref)) return new THREE.Vector3(...ref);
    if (typeof ref !== 'string') return null;
    const built = this.builts.get(ref);
    if (!built) return null;
    const center = new THREE.Vector3();
    built.root.getWorldPosition(center);
    const s = built.root.getWorldScale(new THREE.Vector3()).x;
    if (path.object.type === 'arrow') {
      const other = side === 'out' ? path.object.to : path.object.from;
      const otherPos = isVec3(other) ? new THREE.Vector3(...other) : this.builts.get(other as string)?.root.position;
      if (!otherPos) return center;
      const dir = otherPos.clone().sub(center).normalize();
      return center.add(dir.multiplyScalar(Math.max(built.half.x, built.half.y) * s + 0.08));
    }
    let x: number;
    if (built.object.type === 'gate') {
      const ports = gatePorts(built.object.gate ?? 'buf');
      const size = typeof built.object.size === 'number' ? built.object.size : 1;
      x = (side === 'out' ? ports.outX : ports.inX + 0.04) * size * s;
    } else {
      x = (side === 'out' ? built.half.x : -built.half.x) * s;
    }
    let y = 0;
    const slot = side === 'in' ? this.slots.get(path.object.id) : undefined;
    if (slot && slot.count > 1 && built.object.type === 'gate') {
      y = (0.5 - (slot.index + 0.5) / slot.count) * 0.7 * built.half.y * 2 * s;
    }
    return center.add(new THREE.Vector3(x, y, 0));
  };

  private syncAll(objects?: Record<string, ObjectState>): void {
    const shown = objects ?? this.overrideObjects ?? this.states[this.shown].objects;
    // Groups and solids first so wires read their endpoints' current positions.
    for (const built of this.builts.values()) {
      if (built.path) continue;
      syncPrimitive(built, { theme: this.theme, state: shown[built.object.id], reducedMotion: this.reducedMotion, endpoint: this.endpoint });
    }
    this.stage.scene.updateMatrixWorld();
    for (const built of this.builts.values()) {
      if (!built.path) continue;
      syncPrimitive(built, { theme: this.theme, state: shown[built.object.id], reducedMotion: this.reducedMotion, endpoint: this.endpoint });
    }
  }

  // ---------- timeline and navigation ----------

  private provisionalFractions(): number[] {
    const n = this.states.length;
    return this.states.map((_, i) => (n <= 1 ? 0 : i / (n - 1)));
  }

  private rebuildTimeline(time: number): void {
    this.motion?.timeline.kill();
    setAnims(this.builts, this.states[0], this.theme);
    this.motion = buildTimeline(this.builts, this.objects, this.states, this.theme, () => this.onTick());
    this.motion.timeline.seek(time, false);
    const duration = this.motion.timeline.duration() || 1;
    this.chrome.placeTicks(this.motion.times.map((t) => t / duration));
  }

  private onTick(): void {
    const { timeline, times } = this.motion;
    this.shown = stepAt(times, timeline.time());
    this.stage.invalidate();
    this.render();
  }

  private render(): void {
    const state = this.states[this.shown];
    const duration = this.motion.timeline.duration() || 1;
    const values: Record<string, Scalar | undefined> = {};
    const objects = this.overrideObjects ?? state.objects;
    for (const control of this.spec.controls ?? []) {
      const dot = control.bind.lastIndexOf('.');
      const os = objects[control.bind.slice(0, dot)];
      const prop = control.bind.slice(dot + 1);
      values[control.bind] = os
        ? prop === 'value'
          ? os.value
          : prop === 'x' || prop === 'y' || prop === 'z'
            ? os.at['xyz'.indexOf(prop)]
            : prop === 'scale'
              ? os.scale
              : undefined
        : undefined;
    }
    this.chrome.render(
      {
        index: this.shown,
        count: this.states.length,
        caption: state.caption,
        progress: this.motion.timeline.time() / duration,
        playing: this.playing,
        checkpoint: state.checkpoint,
        settled: this.shown === this.target && !this.nav?.isActive(),
        values,
      },
      this.reducedMotion,
    );
  }

  private learnerGoTo(index: number): void {
    this.pause();
    if (this.goTo(index)) {
      const state = this.states[this.target];
      postToHost({ type: 'DEMO_STEP_CHANGED', step: state.id, index: this.target });
    }
  }

  /** Moves to a step; returns false when the index is out of range. */
  goTo(index: number, instant = false): boolean {
    if (index < 0 || index >= this.states.length) return false;
    const from = this.target;
    this.target = index;
    this.clearOverrides();
    this.introTweens.forEach((t) => t.progress(1).kill());
    this.introTweens = [];
    this.nav?.kill();
    const { timeline, times } = this.motion;
    const label = `s${index}`;
    if (instant || this.reducedMotion) {
      timeline.seek(label, false);
      this.onTick();
    } else {
      const distance = Math.abs(timeline.time() - times[index]);
      const steps = Math.abs(index - from);
      this.nav = timeline.tweenTo(label, {
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
    this.clearOverrides();
    const { timeline } = this.motion;
    timeline.progress(Math.min(Math.max(fraction, 0), 1));
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
      const wait = (this.motion.times[next] - (this.motion.times[next - 1] ?? 0)) + HOLD;
      this.advance(wait);
    });
  }

  // ---------- camera ----------

  private cameraKey(camera: CameraTarget | undefined): string {
    return JSON.stringify(camera ?? 'overview');
  }

  private poseFor(camera: CameraTarget): Pose {
    if (typeof camera === 'object' && isVec3(camera.position) && isVec3(camera.target)) {
      return this.stage.pose(camera.position, camera.target);
    }
    const built = typeof camera === 'string' && camera !== 'overview' ? this.builts.get(camera) : undefined;
    if (!built) return this.stage.frame(this.overviewBox);
    const box = new THREE.Box3().setFromObject(built.root);
    const center = box.getCenter(new THREE.Vector3());
    // Frame the object with room for its neighbours; never tighter than a quarter of the overview.
    const span = Math.max(box.getSize(new THREE.Vector3()).length(), this.overviewBox.getSize(new THREE.Vector3()).length() / 4);
    const half = new THREE.Vector3().setScalar(span / 2);
    return this.stage.frame(new THREE.Box3(center.clone().sub(half), center.clone().add(half)), 1.0);
  }

  private moveCamera(from: CameraTarget | undefined, to: CameraTarget, instant: boolean): void {
    if (this.cameraKey(from) === this.cameraKey(to)) return;
    const pose = this.poseFor(to);
    this.cameraTween?.kill();
    if (instant || this.reducedMotion) {
      this.stage.setPose(pose);
      return;
    }
    const camera = this.stage.camera;
    const target = this.stage.controls.target;
    const start = { p: camera.position.clone(), t: target.clone() };
    const proxy = { k: 0 };
    this.cameraTween = gsap.to(proxy, {
      k: 1,
      duration: 1.3,
      ease: 'power3.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(start.p, pose.position, proxy.k);
        target.lerpVectors(start.t, pose.target, proxy.k);
        this.stage.invalidate();
      },
    });
  }

  // ---------- controls, theme, input ----------

  private setControl(bind: string, value: Scalar): void {
    this.pause();
    this.overrides[bind] = value;
    const state = this.states[this.target];
    this.overrideObjects = withOverrides(this.objects, state, this.overrides);
    for (const [id, built] of this.builts) {
      const os = this.overrideObjects[id];
      if (!os) continue;
      const highlight = state.highlight.includes(id);
      const t = { x: os.at[0], y: os.at[1], z: os.at[2], scale: os.scale };
      const color = new THREE.Color(bodyColor(built.object, os, this.theme)).getRGB(
        { r: 0, g: 0, b: 0 },
        THREE.SRGBColorSpace,
      );
      gsap.to(built.anim, {
        ...t,
        ...color,
        presence: os.visible ? 1 : 0,
        glow: highlight ? 1 : 0,
        duration: this.reducedMotion ? 0 : 0.35,
        ease: 'power2.out',
        overwrite: 'auto',
        onUpdate: () => this.stage.invalidate(),
      });
    }
    this.stage.invalidate();
    this.render();
  }

  private clearOverrides(): void {
    if (!this.overrideObjects) return;
    this.overrides = {};
    this.overrideObjects = null;
    for (const built of this.builts.values()) gsap.killTweensOf(built.anim);
    // Re-render the timeline at its playhead so the anims match the step again.
    const time = this.motion.timeline.time();
    this.rebuildTimeline(time);
  }

  setTheme(name: ThemeName): void {
    if (this.theme.name === name) return;
    this.theme = THEMES[name];
    document.documentElement.setAttribute('data-theme', name);
    this.applyCss();
    this.stage.applyTheme(this.theme);
    for (const built of this.builts.values()) {
      if (built.object.type === 'grid') {
        const grid = built.root.children[0] as THREE.LineSegments;
        (grid.material as THREE.LineBasicMaterial).color.set(this.theme.grid);
      }
    }
    this.rebuildTimeline(this.motion.timeline.time());
    this.onTick();
  }

  private applyCss(): void {
    let style = document.getElementById('dk-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'dk-style';
      document.head.appendChild(style);
    }
    style.textContent = `:root{${cssVariables(this.theme)}color-scheme:${this.theme.name}}${STYLES}`;
  }

  /** Objects rise into place once, in signal order, so the first frame already teaches the layout. */
  private intro(): void {
    if (this.reducedMotion) return;
    let i = 0;
    for (const built of this.builts.values()) {
      if (!this.states[0].objects[built.object.id]?.visible) continue;
      const anim = built.anim;
      const delay = 0.1 + Math.min(i++, 24) * 0.035;
      this.introTweens.push(
        gsap.fromTo(
          anim,
          { presence: 0, y: anim.y - 0.25 },
          { presence: 1, y: anim.y, duration: 0.7, ease: 'power3.out', delay, onUpdate: () => this.stage.invalidate() },
        ),
      );
    }
  }

  private bindPointer(): void {
    const surface = this.stage.labels.domElement;
    let down: { x: number; y: number } | null = null;
    let hovered: Built | null = null;
    let pending = false;
    surface.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    surface.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      down = null;
      const id = this.stage.pick(e.clientX, e.clientY);
      const built = id ? this.builts.get(id) : undefined;
      if (!built || built.object.type === 'grid') return;
      const state = this.states[this.shown];
      postToHost({
        type: 'DEMO_ASK',
        objectId: built.object.id,
        label: state.objects[built.object.id]?.label ?? built.object.label ?? built.object.id,
        ask: built.object.ask ?? '',
        step: state.id,
      });
    });
    surface.addEventListener('pointermove', (e) => {
      if (pending || e.buttons) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const id = this.stage.pick(e.clientX, e.clientY);
        const next = id ? (this.builts.get(id) ?? null) : null;
        const pickable = next && next.object.type !== 'grid' && next.object.type !== 'plane' ? next : null;
        if (pickable === hovered) return;
        if (hovered) hovered.hover = false;
        hovered = pickable;
        if (hovered) hovered.hover = true;
        surface.style.cursor = hovered ? 'pointer' : '';
        this.stage.invalidate();
      });
    });
    surface.addEventListener('pointerleave', () => {
      if (hovered) hovered.hover = false;
      hovered = null;
      this.stage.invalidate();
    });
  }

  private bindKeys(): void {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === '.') this.learnerGoTo(this.target + 1);
      else if (e.key === 'ArrowLeft' || e.key === ',') this.learnerGoTo(this.target - 1);
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) this.playing ? this.pause() : this.play();
      else return;
      e.preventDefault();
    });
  }

  /** Test and debugging handle (window.demoKit). */
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
        return player.stage.looping;
      },
      dispose: () => {
        for (const built of this.builts.values()) disposePrimitive(built);
        this.stage.dispose();
      },
    };
  }
}

function boot(): void {
  const spec = readSpec();
  document.documentElement.setAttribute('data-theme', initialTheme());
  if (!spec) {
    const style = document.createElement('style');
    style.textContent = `:root{${cssVariables(THEMES[initialTheme()])}}${STYLES}`;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'dk-root';
    document.body.appendChild(root);
    const error = document.createElement('div');
    error.className = 'dk-error';
    error.textContent = 'This demo could not be loaded.';
    root.appendChild(error);
    return;
  }
  const player = new DemoPlayer(spec, document.body);
  (window as unknown as { demoKit: unknown }).demoKit = player.api();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
