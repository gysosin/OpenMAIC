import { describe, expect, it } from 'vitest';
import {
  RAIL_WIDTH,
  SIDE_PANEL_WIDTH,
  STAGE_MIN_WIDTH,
  clampPanelWidth,
} from '@/components/classroom/shell/panel-size';

describe('clampPanelWidth', () => {
  it('keeps a width inside its limits', () => {
    expect(clampPanelWidth(400, SIDE_PANEL_WIDTH, 1920, 220)).toBe(400);
  });

  it('clamps to the limits', () => {
    expect(clampPanelWidth(100, SIDE_PANEL_WIDTH, 1920, 0)).toBe(SIDE_PANEL_WIDTH.min);
    expect(clampPanelWidth(900, SIDE_PANEL_WIDTH, 1920, 0)).toBe(SIDE_PANEL_WIDTH.max);
    expect(clampPanelWidth(10, RAIL_WIDTH, 1920, 0)).toBe(RAIL_WIDTH.min);
  });

  it('leaves the stage its minimum width next to the other region', () => {
    // 1366 wide, rail 400 open: the panel gets 1366 - 400 - 480 = 486.
    expect(clampPanelWidth(560, SIDE_PANEL_WIDTH, 1366, 400)).toBe(1366 - 400 - STAGE_MIN_WIDTH);
  });

  it('never takes a region below its own minimum, even on a tiny viewport', () => {
    expect(clampPanelWidth(500, SIDE_PANEL_WIDTH, 700, 400)).toBe(SIDE_PANEL_WIDTH.min);
  });

  it('falls back to the minimum for a bad persisted value', () => {
    expect(clampPanelWidth(Number.NaN, RAIL_WIDTH, 1920, 0)).toBe(RAIL_WIDTH.min);
  });

  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(300.4, RAIL_WIDTH, 1920, 0)).toBe(300);
  });
});
