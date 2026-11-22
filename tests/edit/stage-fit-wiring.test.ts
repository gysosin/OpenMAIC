import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/**
 * Classroom stage: the slide fills its 16:9 box (no 90% studio margin inside a
 * card that is already letterboxed) and the box is a true 16:9 whenever the
 * area is narrower than 16:9 (chat panel open, small window).
 */
describe('classroom stage fit wiring', () => {
  it('sizes the stage box with ContainBox on every host, not CSS max-w-full', () => {
    const canvasArea = source('components/canvas/canvas-area.tsx');
    expect(canvasArea).not.toContain('aspect-[16/9] h-full max-h-full max-w-full');
    expect(canvasArea).toContain('<ContainBox');
  });

  it('drops the 90% margin in playback and keeps it for the editor', () => {
    const playback = source('components/edit/PlaybackChromeRoot.tsx');
    expect(playback).toContain('useWorkbenchProEditing();');
    // The editor shell never mounts the playback chrome, so it keeps the default.
    expect(source('components/edit/EditShell/EditShell.tsx')).not.toContain(
      'useWorkbenchProEditing();',
    );
  });
});
