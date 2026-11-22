import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/base';
import { defaultTheme } from '../fixtures/test-data/slide-theme';
import { SETTINGS_KV_KEY, createSettingsStorage } from '../fixtures/test-data/settings';
import { seedServerDocument, setCurrentScene, uniqueStageId } from '../fixtures/server-seed';

/**
 * Caption modes (A5): in fullscreen the `band` caption is reserved space under the slide, so
 * it never overlaps the stage; `float` is a draggable bubble kept inside the stage; mode and
 * position survive a reload.
 */

const LONG_CAPTION = 'The caption must scroll inside its band, never grow over the slide. '.repeat(
  9,
);

async function openCourse(page: Page, speech: string | null) {
  await page.addInitScript(
    ([key, settings]) => {
      // Seed once: a reload must keep what the test changed.
      if (!localStorage.getItem(key)) localStorage.setItem(key, settings);
      localStorage.setItem('locale', 'en-US');
    },
    [SETTINGS_KV_KEY, createSettingsStorage({ autoPlayLecture: true, ttsMuted: true })],
  );
  await page.goto('/classroom/warmup-nonexistent');
  const stageId = uniqueStageId('caption-modes');
  const sceneId = `${stageId}-s0`;
  const now = Date.now();
  await seedServerDocument(page, {
    stage: { id: stageId, name: 'Caption modes', createdAt: now, updatedAt: now },
    scenes: [
      {
        id: sceneId,
        stageId,
        type: 'slide',
        title: 'Caption modes',
        order: 0,
        content: {
          type: 'slide',
          canvas: {
            id: 'slide-0',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: defaultTheme,
            elements: [
              {
                type: 'text',
                id: 'marker',
                content: 'Caption modes slide',
                left: 0,
                top: 400,
                width: 1000,
                height: 100,
              },
            ],
          },
        },
        actions: speech ? [{ id: 'say', type: 'speech', text: speech }] : [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  await setCurrentScene(page, stageId, sceneId);
  await page.goto(`/classroom/${stageId}`);
  await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
}

async function enterFullscreen(page: Page) {
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.hasAttribute('data-playback-stage')),
    )
    .toBe(true);
}

/** Start the lecture from the centre play button so the caption has a speaker. */
async function startLecture(page: Page) {
  const box = (await page.getByTestId('stage-box').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

type Rect = { x: number; y: number; width: number; height: number };

async function rect(page: Page, testId: string): Promise<Rect> {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, testId).not.toBeNull();
  return box!;
}

function intersects(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

function inside(inner: Rect, outer: Rect) {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

async function persistedCaption(page: Page) {
  return page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}').state ?? {};
    return { mode: state.captionMode, pos: state.captionFloatPos };
  }, SETTINGS_KV_KEY);
}

test.describe('Caption modes', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('band mode keeps a very long caption off the slide and scrolls it', async ({
    page,
  }, testInfo) => {
    await openCourse(page, LONG_CAPTION.repeat(2));
    await enterFullscreen(page);
    await startLecture(page);
    const caption = page.getByTestId('caption');
    await expect(caption).toHaveAttribute('data-mode', 'band');
    await expect(page.getByTestId('caption-text')).toContainText('The caption must scroll');

    const stage = await rect(page, 'stage-box');
    const band = await rect(page, 'caption');
    expect(intersects(stage, band)).toBe(false);
    expect(band.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(band.y + band.height).toBeLessThanOrEqual(1080 + 1);
    expect(band.height).toBeLessThanOrEqual(72);

    // The text is revealed as it is spoken: once it is long, it scrolls inside the band.
    await expect
      .poll(() =>
        page
          .getByTestId('caption-text')
          .evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight <= 64),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('caption-band-fullscreen.png') });
  });

  test('band mode with no caption still reserves its strip clear of the slide', async ({
    page,
  }) => {
    await openCourse(page, null);
    await enterFullscreen(page);
    await expect(page.getByTestId('caption')).toHaveAttribute('data-mode', 'band');
    await expect(page.getByTestId('caption-text')).toHaveCount(0);
    expect(intersects(await rect(page, 'stage-box'), await rect(page, 'caption'))).toBe(false);
  });

  test('Shift+T cycles band, float, pill, off and back', async ({ page }) => {
    await openCourse(page, LONG_CAPTION);
    await enterFullscreen(page);
    await startLecture(page);
    const caption = page.getByTestId('caption');
    for (const mode of ['float', 'pill']) {
      await page.keyboard.press('Shift+T');
      await expect(caption).toHaveAttribute('data-mode', mode);
    }
    await page.keyboard.press('Shift+T');
    await expect(caption).toHaveCount(0);
    expect((await persistedCaption(page)).mode).toBe('off');
    await page.keyboard.press('Shift+T');
    await expect(caption).toHaveAttribute('data-mode', 'band');
  });

  test('float bubble drags, stays inside the stage and survives a reload', async ({
    page,
  }, testInfo) => {
    await openCourse(page, LONG_CAPTION.slice(0, 200));
    await enterFullscreen(page);
    await startLecture(page);
    await page.keyboard.press('Shift+T');
    const caption = page.getByTestId('caption');
    await expect(caption).toHaveAttribute('data-mode', 'float');

    const stage = await rect(page, 'stage-box');
    const start = await rect(page, 'caption');
    expect(inside(start, stage)).toBe(true);

    // Drag the grip well past the top-right corner: the bubble must stop at the stage edge.
    const grip = await rect(page, 'caption-drag-handle');
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 300, from.y - 200, { steps: 8 });
    await page.mouse.move(stage.x + stage.width + 400, stage.y - 400, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await rect(page, 'caption')).y).toBeLessThan(start.y - 100);
    const moved = await rect(page, 'caption');
    expect(inside(moved, stage)).toBe(true);
    expect(intersects(moved, stage)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('caption-float-fullscreen.png') });

    const saved = await persistedCaption(page);
    expect(saved.mode).toBe('float');
    expect(saved.pos.x).toBeGreaterThan(0.9);
    expect(saved.pos.y).toBeLessThan(0.1);

    // Reload: mode and position come back from the store.
    await page.reload();
    await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
    await enterFullscreen(page);
    await startLecture(page);
    await expect(caption).toHaveAttribute('data-mode', 'float');
    const reloaded = await rect(page, 'caption');
    const stageAfter = await rect(page, 'stage-box');
    expect(inside(reloaded, stageAfter)).toBe(true);
    expect(Math.abs(reloaded.x + reloaded.width - (stageAfter.x + stageAfter.width))).toBeLessThan(
      40,
    );
    expect(reloaded.y - stageAfter.y).toBeLessThan(40);
  });
});
