/** Width limits of the classroom's two side regions (UI.md section 2), in px. */
export const RAIL_WIDTH = { min: 170, max: 400 } as const;
export const SIDE_PANEL_WIDTH = { min: 320, max: 560 } as const;

/** The stage never gets narrower than this, whatever the side regions ask for. */
export const STAGE_MIN_WIDTH = 480;

interface Limits {
  readonly min: number;
  readonly max: number;
}

/**
 * Clamp a persisted or dragged width to its limits, and to what the viewport can spare once
 * the other open region and the stage minimum are accounted for. The viewport cap never takes
 * a region below its own minimum.
 *
 * @param otherWidth Width of the other side region (0 when collapsed).
 */
export function clampPanelWidth(
  width: number,
  limits: Limits,
  viewportWidth: number,
  otherWidth: number,
): number {
  const spare = viewportWidth - otherWidth - STAGE_MIN_WIDTH;
  const max = Math.max(limits.min, Math.min(limits.max, spare));
  const value = Number.isFinite(width) ? width : limits.min;
  return Math.round(Math.min(max, Math.max(limits.min, value)));
}
