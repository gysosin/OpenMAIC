/**
 * Builds three.js objects for the C3 primitives and writes animated values
 * into them.
 *
 * Every primitive owns an `anim` record of plain numbers (position, scale,
 * colour, presence, highlight glow, pulse progress). gsap tweens those numbers
 * (motion.ts); `sync()` copies them into meshes, materials and labels once per
 * frame. Labels are CSS2D elements filled with textContent only, so spec
 * strings never become markup.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectState } from './timeline';
import { isVec3, truthy } from './timeline';
import { resolveColor, type Theme } from './theme';
import type { DemoObject, GateKind, Vec3 } from './types';

export interface Anim {
  x: number;
  y: number;
  z: number;
  scale: number;
  r: number;
  g: number;
  b: number;
  presence: number;
  glow: number;
  bump: number;
}

export interface Built {
  object: DemoObject;
  root: THREE.Object3D;
  anim: Anim;
  /** Local half extents, for ports and camera framing. */
  half: THREE.Vector3;
  bodies: THREE.MeshStandardMaterial[];
  outline?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  labelEl?: HTMLElement;
  valueEl?: HTMLElement;
  /** Wires and arrows: rebuilt when an endpoint moves. */
  path?: { key: string; curve?: THREE.Curve<THREE.Vector3>; mesh: THREE.Mesh; bead?: THREE.Mesh };
  hover: boolean;
}

const SOLID_TYPES = new Set(['box', 'sphere', 'cylinder', 'cell', 'gate', 'plane', 'surface']);

function sizeVec(object: DemoObject, fallback: Vec3): Vec3 {
  const s = object.size;
  if (typeof s === 'number' && s > 0) return [s, s, s];
  if (isVec3(s) && s.every((n) => n > 0)) return s;
  return fallback;
}

function material(theme: Theme): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: theme.off,
    roughness: 0.62,
    metalness: 0,
    transparent: true,
  });
}

// ---------- gate silhouettes (XY plane, about 1.5 x 1 units) ----------

function gateShapes(kind: GateKind): { shapes: THREE.Shape[]; bubble: boolean; inX: number } {
  const bubble = kind === 'not' || kind === 'nand' || kind === 'nor' || kind === 'xnor';
  const base = kind.replace(/^n(?=and|or)/, '').replace('xnor', 'xor');
  if (base === 'not' || base === 'buf') {
    const s = new THREE.Shape();
    s.moveTo(-0.6, -0.5);
    s.lineTo(0.55, 0);
    s.lineTo(-0.6, 0.5);
    s.closePath();
    return { shapes: [s], bubble, inX: -0.6 };
  }
  if (base === 'and') {
    const s = new THREE.Shape();
    s.moveTo(-0.7, -0.5);
    s.lineTo(0.05, -0.5);
    s.absarc(0.05, 0, 0.5, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-0.7, 0.5);
    s.closePath();
    return { shapes: [s], bubble, inX: -0.7 };
  }
  const or = new THREE.Shape();
  or.moveTo(-0.7, -0.5);
  or.quadraticCurveTo(0.15, -0.5, 0.75, 0);
  or.quadraticCurveTo(0.15, 0.5, -0.7, 0.5);
  or.quadraticCurveTo(-0.42, 0, -0.7, -0.5);
  const shapes = [or];
  if (base === 'xor') {
    const arc = new THREE.Shape();
    arc.moveTo(-0.92, -0.5);
    arc.quadraticCurveTo(-0.64, 0, -0.92, 0.5);
    arc.lineTo(-0.84, 0.5);
    arc.quadraticCurveTo(-0.56, 0, -0.84, -0.5);
    arc.closePath();
    shapes.push(arc);
  }
  return { shapes, bubble, inX: base === 'xor' ? -0.88 : -0.62 };
}

const GATE_DEPTH = 0.34;

function gateMesh(kind: GateKind, mat: THREE.MeshStandardMaterial): THREE.Group {
  const { shapes, bubble } = gateShapes(kind);
  const group = new THREE.Group();
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: GATE_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 4,
    curveSegments: 28,
  });
  geometry.translate(0, 0, -GATE_DEPTH / 2);
  group.add(new THREE.Mesh(geometry, mat));
  if (bubble) {
    const tip = kind === 'not' ? 0.55 : kind === 'nand' ? 0.55 : 0.75;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, GATE_DEPTH, 24), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.x = tip + 0.13;
    group.add(ring);
  }
  return group;
}

/** Input x and output x of a gate (local), so wires meet the silhouette. */
export function gatePorts(kind: GateKind): { inX: number; outX: number } {
  const { inX, bubble } = gateShapes(kind);
  const tip = kind === 'not' || kind === 'buf' || kind === 'nand' || kind === 'and' ? 0.55 : 0.75;
  return { inX, outX: bubble ? tip + 0.24 : tip };
}

// ---------- labels ----------

function cssLabel(className: string): { el: HTMLElement; obj: CSS2DObject } {
  const el = document.createElement('div');
  el.className = className;
  const obj = new CSS2DObject(el);
  return { el, obj };
}

// ---------- build ----------

export function buildPrimitive(object: DemoObject, theme: Theme): Built {
  const root = new THREE.Group();
  root.userData.demoId = object.id;
  const anim: Anim = { x: 0, y: 0, z: 0, scale: 1, r: 0, g: 0, b: 0, presence: 1, glow: 0, bump: 0 };
  const built: Built = { object, root, anim, half: new THREE.Vector3(0.5, 0.5, 0.5), bodies: [], hover: false };
  const add = (mesh: THREE.Object3D) => {
    mesh.traverse((child) => {
      child.userData.demoId = object.id;
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    root.add(mesh);
  };

  switch (object.type) {
    case 'box':
    case 'cell': {
      const [w, h, d] = sizeVec(object, object.type === 'cell' ? [1, 1, 0.5] : [1, 1, 1]);
      const mat = material(theme);
      const radius = Math.min(w, h, d) * 0.14;
      add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, radius), mat));
      built.bodies.push(mat);
      built.half.set(w / 2, h / 2, d / 2);
      break;
    }
    case 'sphere': {
      const r = typeof object.size === 'number' && object.size > 0 ? object.size : 0.5;
      const mat = material(theme);
      add(new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat));
      built.bodies.push(mat);
      built.half.setScalar(r);
      break;
    }
    case 'cylinder': {
      const [r, h] = sizeVec(object, [0.4, 1, 0.4]);
      const mat = material(theme);
      add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), mat));
      built.bodies.push(mat);
      built.half.set(r, h / 2, r);
      break;
    }
    case 'plane': {
      const [w, , d] = sizeVec(object, [4, 1, 4]);
      const mat = material(theme);
      mat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, 0.06, d, 2, 0.03), mat);
      add(mesh);
      built.bodies.push(mat);
      built.half.set(w / 2, 0.03, d / 2);
      break;
    }
    case 'gate': {
      const s = typeof object.size === 'number' && object.size > 0 ? object.size : 1;
      const mat = material(theme);
      const mesh = gateMesh(object.gate ?? 'buf', mat);
      mesh.scale.setScalar(s);
      add(mesh);
      built.bodies.push(mat);
      built.half.set(0.8 * s, 0.5 * s, (GATE_DEPTH / 2 + 0.05) * s);
      break;
    }
    case 'surface': {
      const [w, hScale, d] = sizeVec(object, [4, 1, 4]);
      const rows = (object.heights ?? []).slice(0, 64).map((r) => r.slice(0, 64));
      const ny = Math.max(rows.length, 2);
      const nx = Math.max(...rows.map((r) => r.length), 2);
      const geometry = new THREE.PlaneGeometry(w, d, nx - 1, ny - 1);
      geometry.rotateX(-Math.PI / 2);
      const pos = geometry.attributes.position;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const h = rows[j]?.[i];
          pos.setY(j * nx + i, (typeof h === 'number' && Number.isFinite(h) ? h : 0) * hScale);
        }
      }
      geometry.computeVertexNormals();
      const mat = material(theme);
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.8;
      add(new THREE.Mesh(geometry, mat));
      const wire = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.18, color: theme.text }),
      );
      add(wire);
      built.bodies.push(mat);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      built.half.set(w / 2, Math.max(box.max.y, -box.min.y, 0.05), d / 2);
      break;
    }
    case 'grid': {
      const size = typeof object.size === 'number' && object.size > 0 ? object.size : 10;
      const grid = new THREE.GridHelper(size, Math.round(size), theme.grid, theme.grid);
      (grid.material as THREE.Material).transparent = true;
      root.add(grid);
      built.half.set(size / 2, 0.01, size / 2);
      break;
    }
    case 'wire':
    case 'arrow': {
      const mat = material(theme);
      mat.roughness = 0.45;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.castShadow = true;
      mesh.userData.demoId = object.id;
      root.add(mesh);
      built.bodies.push(mat);
      built.path = { key: '', mesh };
      if (object.type === 'wire') {
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 24, 16),
          new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true }),
        );
        bead.visible = false;
        root.add(bead);
        built.path.bead = bead;
      }
      break;
    }
    case 'label':
    case 'group':
      built.half.setScalar(0.3);
      break;
  }

  if (isVec3(object.rotation)) {
    const [rx, ry, rz] = object.rotation.map(THREE.MathUtils.degToRad);
    for (const child of root.children) child.rotation.set(rx, ry, rz);
  }

  // Outline shell for highlight and hover: the body geometry drawn back-face,
  // slightly larger, in the highlight colour.
  const firstMesh = root.children[0] as THREE.Mesh | undefined;
  if (SOLID_TYPES.has(object.type) && object.type !== 'surface' && firstMesh) {
    const target = (firstMesh as THREE.Mesh).isMesh ? firstMesh : (firstMesh.children[0] as THREE.Mesh);
    const outline = new THREE.Mesh(
      target.geometry,
      new THREE.MeshBasicMaterial({ color: theme.highlight, side: THREE.BackSide, transparent: true, opacity: 0 }),
    );
    const pad = 0.07;
    const h = built.half;
    const parentScale = target === firstMesh ? 1 : firstMesh.scale.x;
    outline.scale.set(1 + pad / h.x, 1 + pad / h.y, 1 + pad / Math.max(h.z, 0.03));
    outline.rotation.copy(firstMesh.rotation);
    outline.position.copy(target.position).multiplyScalar(parentScale);
    if (target !== firstMesh) outline.scale.multiplyScalar(parentScale);
    outline.visible = false;
    outline.userData.demoId = object.id;
    root.add(outline);
    built.outline = outline;
  }

  // Name label: below cells (the value sits on the face), centred on gates, above the rest.
  if (object.type !== 'wire' && object.type !== 'grid') {
    const kind =
      object.type === 'label' ? 'dk-label dk-label--free' : object.type === 'gate' ? 'dk-label dk-label--gate' : 'dk-label';
    const { el, obj } = cssLabel(kind);
    const h = built.half;
    if (object.type === 'cell') obj.position.set(0, -h.y - 0.32, 0);
    else if (object.type === 'gate') obj.position.set(-0.08, 0, h.z + 0.02);
    else if (object.type !== 'label') obj.position.set(0, h.y + 0.34, 0);
    root.add(obj);
    built.labelEl = el;
  }
  if (object.type === 'cell' || object.type === 'box') {
    const { el, obj } = cssLabel('dk-value');
    obj.position.set(0, 0, built.half.z + 0.01);
    root.add(obj);
    built.valueEl = el;
  }
  return built;
}

// ---------- colour rules ----------

function isBit(value: unknown): boolean {
  return value === 0 || value === 1 || value === true || value === false || value === '0' || value === '1';
}

const DEFAULT_COLOR: Partial<Record<DemoObject['type'], string>> = {
  box: 'blue',
  sphere: 'sky',
  cylinder: 'teal',
  arrow: 'orange',
  surface: 'sky',
};

/** The body colour an object should have in this state. */
export function bodyColor(object: DemoObject, state: ObjectState, theme: Theme): string {
  const color = state.color ?? object.color;
  if (object.type === 'plane') return resolveColor(theme, color, theme.raised);
  if (object.type === 'wire' || object.type === 'gate' || object.type === 'cell' || isBit(state.value)) {
    if (!isBit(state.value)) return object.type === 'wire' ? theme.off : resolveColor(theme, color, theme.off);
    return truthy(state.value) ? resolveColor(theme, color, theme.accent) : theme.off;
  }
  const fallback = DEFAULT_COLOR[object.type];
  return resolveColor(theme, color, fallback ? theme.named[fallback as 'blue'] : theme.off);
}

// ---------- per-frame sync ----------

const tmpColor = new THREE.Color();

export interface SyncContext {
  theme: Theme;
  /** Discrete state for text (values, labels) at the current playhead. */
  state?: ObjectState;
  reducedMotion: boolean;
  /** World position of an endpoint (object port or point). */
  endpoint: (ref: string | Vec3 | undefined, side: 'out' | 'in', wire: Built) => THREE.Vector3 | null;
}

export function syncPrimitive(built: Built, ctx: SyncContext): void {
  const { anim, root, object } = built;
  const presence = THREE.MathUtils.clamp(anim.presence, 0, 1);
  root.visible = presence > 0.01;
  if (object.type !== 'wire' && object.type !== 'arrow') {
    root.position.set(anim.x, anim.y, anim.z);
  }
  const bump = anim.bump > 0 && anim.bump < 1 ? Math.sin(Math.PI * anim.bump) : 0;
  const grow = anim.scale * (0.9 + 0.1 * presence) * (1 + 0.12 * bump);
  if (object.type !== 'wire' && object.type !== 'arrow' && object.type !== 'group') root.scale.setScalar(Math.max(grow, 0.001));
  tmpColor.setRGB(anim.r, anim.g, anim.b, THREE.SRGBColorSpace);
  for (const mat of built.bodies) {
    mat.color.copy(tmpColor);
    mat.opacity = presence;
    mat.depthWrite = presence > 0.98;
    mat.emissive.copy(tmpColor).multiplyScalar(0.06 + 0.14 * bump);
  }
  const glow = Math.max(anim.glow, built.hover ? 0.55 : 0);
  if (built.outline) {
    built.outline.visible = glow > 0.01 && root.visible;
    built.outline.material.opacity = glow * presence;
    built.outline.material.color.set(ctx.theme.highlight);
  }
  for (const el of [built.labelEl, built.valueEl]) {
    if (!el) continue;
    el.style.opacity = String(presence);
    el.style.visibility = presence > 0.01 ? 'visible' : 'hidden';
  }
  if (built.labelEl) {
    const text = ctx.state?.label ?? object.label ?? '';
    const gateText = object.type === 'gate' && !text ? (object.gate ?? '').toUpperCase() : text;
    if (built.labelEl.textContent !== gateText) built.labelEl.textContent = gateText;
    built.labelEl.classList.toggle('is-highlight', glow > 0.5);
    if (object.type === 'gate') built.labelEl.classList.toggle('is-on', truthy(ctx.state?.value));
  }
  if (built.valueEl) {
    const value = ctx.state?.value;
    const text = value === undefined ? '' : typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    if (built.valueEl.textContent !== text) built.valueEl.textContent = text;
    built.valueEl.classList.toggle('is-on', isBit(value) && truthy(value));
  }
  if (built.path) syncPath(built, ctx, presence, bump);
}

function syncPath(built: Built, ctx: SyncContext, presence: number, bump: number): void {
  const path = built.path!;
  const { object } = built;
  const a = ctx.endpoint(object.from, 'out', built);
  const b = ctx.endpoint(object.to, 'in', built);
  if (!a || !b) {
    built.root.visible = false;
    return;
  }
  const key = `${a.toArray().map((n) => n.toFixed(3))}|${b.toArray().map((n) => n.toFixed(3))}`;
  if (key !== path.key) {
    path.key = key;
    path.mesh.geometry.dispose();
    if (object.type === 'wire') {
      const dx = Math.max(Math.abs(b.x - a.x) * 0.5, 0.4);
      const curve = new THREE.CubicBezierCurve3(
        a,
        a.clone().add(new THREE.Vector3(dx, 0, 0)),
        b.clone().sub(new THREE.Vector3(dx, 0, 0)),
        b,
      );
      path.curve = curve;
      path.mesh.geometry = new THREE.TubeGeometry(curve, 64, 0.042, 12, false);
    } else {
      const dir = b.clone().sub(a);
      const length = dir.length();
      const head = Math.min(0.32, length * 0.35);
      const shaft = new THREE.CylinderGeometry(0.045, 0.045, Math.max(length - head, 0.001), 16);
      shaft.translate(0, (length - head) / 2, 0);
      const cone = new THREE.ConeGeometry(0.13, head, 24);
      cone.translate(0, length - head / 2, 0);
      const merged = mergeTwo(shaft, cone);
      merged.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      merged.translate(a.x, a.y, a.z);
      path.mesh.geometry = merged;
    }
  }
  if (path.bead && path.curve) {
    const show = bump > 0 && !ctx.reducedMotion;
    path.bead.visible = show && built.root.visible;
    if (show) {
      path.bead.position.copy(path.curve.getPoint(THREE.MathUtils.clamp(built.anim.bump, 0, 1)));
      const mat = path.bead.material as THREE.MeshBasicMaterial;
      mat.color.set(ctx.theme.accent);
      mat.opacity = Math.min(1, bump * 1.6) * presence;
      path.bead.scale.setScalar(0.7 + 0.5 * bump);
    }
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.toNonIndexed();
  const gb = b.toNonIndexed();
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal'] as const) {
    const x = ga.getAttribute(name).array as Float32Array;
    const y = gb.getAttribute(name).array as Float32Array;
    const merged = new Float32Array(x.length + y.length);
    merged.set(x);
    merged.set(y, x.length);
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3));
  }
  return out;
}

export function disposePrimitive(built: Built): void {
  built.root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose();
    }
    if (child instanceof CSS2DObject) child.element.remove();
  });
}
