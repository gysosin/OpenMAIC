/**
 * The 3D stage: renderer, camera framing, lights, orbit controls, picking and
 * an on-demand render loop that stops while the frame is hidden or off screen
 * and releases its WebGL context on pagehide (the iframe pool keeps several
 * pages alive, and browsers cap live contexts at about 16).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Theme } from './theme';
import type { Vec3 } from './types';

export interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Overview direction: a little above and to the right, so flat boards read as 2.5D. */
const VIEW_DIR = new THREE.Vector3(0.2, 0.36, 1).normalize();

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly controls: OrbitControls;
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#202020', 1.5);
  private readonly key = new THREE.DirectionalLight('#ffffff', 2.1);
  private readonly fill = new THREE.DirectionalLight('#ffffff', 0.55);
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private frames = 0;
  private running = false;
  private visible = true;
  private onScreen = true;
  private raf = 0;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];
  /** Called before each rendered frame (animation sync). */
  beforeRender: () => void = () => {};

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'dk-canvas';
    host.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'dk-labels';
    host.appendChild(this.labels.domElement);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 6;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.2, transparent: true }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('change', () => this.invalidate());

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(host);
    this.cleanups.push(() => resize.disconnect());

    const onVisibility = () => {
      this.visible = document.visibilityState !== 'hidden';
      this.updateLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // The implicit root is the top-level viewport, so this also fires when the
    // host scrolls the iframe away or hides it.
    const io = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
      this.updateLoop();
    });
    io.observe(host);
    this.cleanups.push(() => io.disconnect());

    const onPageHide = () => this.dispose();
    window.addEventListener('pagehide', onPageHide);
    this.cleanups.push(() => window.removeEventListener('pagehide', onPageHide));
    this.resize();
  }

  applyTheme(theme: Theme): void {
    this.scene.background = new THREE.Color(theme.canvas);
    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.hemi.intensity = theme.name === 'dark' ? 1.75 : 1.6;
    this.key.intensity = theme.name === 'dark' ? 1.6 : 1.9;
    this.ground.material.opacity = theme.shadowOpacity;
    this.ground.material.color.set(theme.name === 'dark' ? '#000000' : '#1a1a2a');
    this.invalidate();
  }

  /** Places the ground under the content and aims the key light's shadow camera at it. */
  setBounds(box: THREE.Box3): void {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    this.ground.position.y = box.min.y - 0.02;
    this.key.position.copy(center).add(new THREE.Vector3(-0.45, 1.1, 0.75).multiplyScalar(radius * 3));
    this.key.target.position.copy(center);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -radius * 1.6;
    cam.right = cam.top = radius * 1.6;
    cam.near = 0.1;
    cam.far = radius * 8;
    cam.updateProjectionMatrix();
    this.fill.position.copy(center).add(new THREE.Vector3(1, 0.4, -0.8).multiplyScalar(radius * 3));
    this.controls.maxDistance = radius * 8;
    this.controls.minDistance = radius * 0.3;
  }

  /**
   * Camera pose that fits a box's eight corners into the free band of the
   * frame: `top` and `bottom` are the shares of the frame height the chrome
   * covers, and the content centres between them.
   */
  frame(box: THREE.Box3, padding = 1.04, top = 0.11, bottom = 0.21): Pose {
    const center = box.getCenter(new THREE.Vector3());
    const forward = VIEW_DIR.clone();
    const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
    const up = forward.clone().cross(right).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;
    const band = 1 - top - bottom;
    let distance = 1;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).sub(center);
          const depth = p.dot(forward);
          distance = Math.max(
            distance,
            (Math.abs(p.dot(right)) * padding) / tanH + depth,
            (Math.abs(p.dot(up)) * padding) / (tanV * band) + depth,
          );
        }
      }
    }
    // Aim below the centre so the content sits midway in the free band.
    const target = center.clone().add(up.multiplyScalar(-tanV * distance * (bottom - top)));
    return { target, position: target.clone().add(forward.multiplyScalar(distance)) };
  }

  pose(position: Vec3, target: Vec3): Pose {
    return { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
  }

  setPose(pose: Pose): void {
    this.camera.position.copy(pose.position);
    this.controls.target.copy(pose.target);
    this.controls.update();
    this.invalidate();
  }

  /** The demo object id under a client point, if any. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      if (!isVisible(node)) continue;
      while (node && node.userData.demoId === undefined) node = node.parent;
      if (node?.userData.demoId) return node.userData.demoId as string;
    }
    return null;
  }

  invalidate(frames = 2): void {
    this.frames = Math.max(this.frames, frames);
    this.updateLoop();
  }

  private updateLoop(): void {
    const should = !this.disposed && this.visible && this.onScreen;
    if (should && !this.running) {
      this.running = true;
      this.raf = requestAnimationFrame(this.tick);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  /** True while the loop is scheduled; exposed for tests. */
  get looping(): boolean {
    return this.running;
  }

  private readonly tick = () => {
    if (!this.running) return;
    const moving = this.controls.update();
    if (moving) this.frames = Math.max(this.frames, 1);
    if (this.frames > 0) {
      this.frames--;
      this.beforeRender();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.updateLoop();
    for (const cleanup of this.cleanups) cleanup();
    this.controls.dispose();
    this.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function isVisible(node: THREE.Object3D | null): boolean {
  for (let n = node; n; n = n.parent) if (!n.visible) return false;
  return true;
}
