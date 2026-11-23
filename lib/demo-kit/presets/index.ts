/**
 * Preset registry: `kind: "preset"` specs expand here into scene3d specs.
 * Presets are pure functions of their params (no three, no DOM), so the
 * server can expand them too, for example to read step ids and captions.
 * Param schemas for the generation side: packages/@openmaic/generation/src/demo-presets.ts.
 */
import type { PresetName } from '@openmaic/generation';
import type { DemoSpec } from '../core/types';
import { bitRegister } from './bit-register';
import { dataStructure } from './data-structure';
import { logicCircuit } from './logic-circuit';
import { memoryGrid } from './memory-grid';

export const PRESETS: Record<PresetName, (params?: Record<string, unknown>) => DemoSpec> = {
  'bit-register': bitRegister,
  'logic-circuit': logicCircuit,
  'memory-grid': memoryGrid,
  'data-structure': dataStructure,
};

/** A preset spec as a scene3d spec (its own title wins); null for an unknown preset. */
export function expandPreset(spec: DemoSpec): DemoSpec | null {
  const preset = Object.hasOwn(PRESETS, spec.preset ?? '')
    ? PRESETS[spec.preset as PresetName]
    : undefined;
  if (!preset) return null;
  const params =
    spec.params && typeof spec.params === 'object' && !Array.isArray(spec.params)
      ? spec.params
      : {};
  const out = preset(params);
  return spec.title?.trim() ? { ...out, title: spec.title } : out;
}
