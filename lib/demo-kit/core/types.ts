/**
 * DemoSpec v1 as the kit reads it (docs/fork-plan/PLAN.md, section C3).
 *
 * Mirrors the zod schema in packages/@openmaic/generation/src/demo-spec.ts;
 * the validator drops unknown fields before a spec reaches the kit, but the
 * kit still treats every field as untrusted and optional where it can.
 */

export type Vec3 = [number, number, number];
export type Scalar = number | string | boolean;

export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'plane'
  | 'arrow'
  | 'wire'
  | 'label'
  | 'grid'
  | 'group'
  | 'cell'
  | 'gate'
  | 'surface';

export type GateKind = 'and' | 'or' | 'xor' | 'not' | 'nand' | 'nor' | 'xnor' | 'buf';

/** Named colours resolve per theme (theme.ts); a `#rrggbb` hex is used as is. */
export type ColorName =
  | 'accent'
  | 'blue'
  | 'orange'
  | 'teal'
  | 'yellow'
  | 'vermilion'
  | 'purple'
  | 'sky'
  | 'neutral';

export interface DemoObject {
  id: string;
  type: PrimitiveType;
  at?: Vec3;
  /** Euler angles in degrees. */
  rotation?: Vec3;
  /** box/cell/plane/grid/surface extents; a number means a uniform size or a radius. */
  size?: number | Vec3;
  label?: string;
  ask?: string;
  color?: ColorName | string;
  value?: Scalar;
  hidden?: boolean;
  /** Id of a `group` object; position is then relative to the group. */
  parent?: string;
  gate?: GateKind;
  /** wire / arrow endpoints: an object id or a point. */
  from?: string | Vec3;
  to?: string | Vec3;
  /** surface: row-major heights, rows along z, columns along x. */
  heights?: number[][];
}

export interface Checkpoint {
  question: string;
  options: string[];
  /** Index into options. */
  answer: number;
}

export type CameraTarget = string | { position: Vec3; target: Vec3 };

export interface DemoStep {
  id: string;
  caption?: string;
  /** `"<objectId>.<prop>": value`; props: value, label, color, visible, x, y, z, scale. */
  set?: Record<string, Scalar>;
  show?: string[];
  hide?: string[];
  move?: Record<string, Vec3>;
  pulse?: string[];
  highlight?: string[];
  /** Object id to frame, `"overview"`, or an explicit pose. */
  camera?: CameraTarget;
  checkpoint?: Checkpoint;
}

export interface DemoControl {
  id: string;
  type: 'toggle' | 'slider';
  /** `"<objectId>.<prop>"`, same keys as a step's `set`. */
  bind: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface DemoSpec {
  version: 1;
  kind: 'scene3d' | 'flow' | 'preset';
  preset?: string;
  params?: Record<string, unknown>;
  title?: string;
  objects?: DemoObject[];
  steps?: DemoStep[];
  controls?: DemoControl[];
}
