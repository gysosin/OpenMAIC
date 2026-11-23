/**
 * DemoSpec v1 as the kit reads it (docs/fork-plan/PLAN.md, section C3).
 *
 * The zod schema in packages/@openmaic/generation/src/demo-spec.ts is the single
 * source of truth. Type-only re-exports keep zod out of the kit bundle; the
 * kit still treats every field as untrusted where it can.
 */
import type { DemoSpec as ValidatedSpec } from '@openmaic/generation';

export type {
  CameraTarget,
  Checkpoint,
  ColorName,
  DemoControl,
  DemoObject,
  DemoStep,
  FlowIcon,
  FlowType,
  GateKind,
  PrimitiveType,
  Scalar,
  Vec3,
} from '@openmaic/generation';

/** The kit tolerates hand-built specs that omit the validator's defaulted fields. */
export type DemoSpec = Omit<ValidatedSpec, 'title' | 'objects' | 'steps' | 'controls'> &
  Partial<Pick<ValidatedSpec, 'title' | 'objects' | 'steps' | 'controls'>>;
