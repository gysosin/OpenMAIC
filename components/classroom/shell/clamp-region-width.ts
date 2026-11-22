import { useSettingsStore } from '@/lib/store/settings';
import { RAIL_WIDTH, SIDE_PANEL_WIDTH, clampPanelWidth } from './panel-size';

/**
 * `width` for the scene rail or the side panel, clamped to its limits and to the room the
 * current viewport leaves next to the other region's persisted state. Call it while dragging.
 */
export function clampRegionWidth(region: 'rail' | 'panel', width: number): number {
  const s = useSettingsStore.getState();
  const rail = region === 'rail';
  const other = rail
    ? s.chatAreaCollapsed
      ? 0
      : s.chatAreaWidth
    : s.sidebarCollapsed
      ? 0
      : s.sidebarWidth;
  return clampPanelWidth(width, rail ? RAIL_WIDTH : SIDE_PANEL_WIDTH, window.innerWidth, other);
}
