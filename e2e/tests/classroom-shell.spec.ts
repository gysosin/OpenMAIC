import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/base';
import { defaultTheme } from '../fixtures/test-data/slide-theme';
import { SETTINGS_KV_KEY, createSettingsStorage } from '../fixtures/test-data/settings';
import { seedServerDocument, uniqueStageId } from '../fixtures/server-seed';

/**
 * Classroom shell (D1): scene rail, stage and side panel. Each side region collapses with its
 * one control, resizes by drag, and keeps both after a reload; the page never scrolls sideways
 * and the stage stays a large share of the viewport.
 */

const SHOTS = process.env.SHOTS_DIR;
const THEME = process.env.SHOT_THEME ?? 'light';

async function openCourse(page: Page, sceneCount: number) {
  await page.addInitScript(
    ([key, value, theme]) => {
      // Seed once: a reload must keep what the test changed.
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      localStorage.setItem('locale', 'en-US');
      localStorage.setItem('theme', theme);
    },
    [
      SETTINGS_KV_KEY,
      createSettingsStorage({ ttsMuted: true, sidebarCollapsed: false, chatAreaCollapsed: false }),
      THEME,
    ],
  );
  const stageId = uniqueStageId('classroom-shell');
  const now = Date.now();
  const scenes = Array.from({ length: sceneCount }, (_, order) => ({
    id: `${stageId}-s${order}`,
    stageId,
    type: 'slide',
    title: `Binary place values, part ${order + 1}`,
    order,
    createdAt: now,
    updatedAt: now,
    content: {
      type: 'slide',
      canvas: {
        id: `slide-${order}`,
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: defaultTheme,
        elements: [
          {
            type: 'text',
            id: 'marker',
            content: `Each extra bit doubles the number of patterns (${order + 1})`,
            left: 0,
            top: 200,
            width: 1000,
            height: 100,
          },
        ],
      },
    },
  }));
  await seedServerDocument(page, {
    stage: {
      id: stageId,
      name: 'Why computers speak in bits and bytes',
      createdAt: now,
      updatedAt: now,
      generatedAgentConfigs: [{ id: 'agent-1', name: 'Agent 1', priority: 1 }],
    },
    scenes,
    outline: {
      outlines: scenes.map(({ type, title, order }) => ({
        id: `o${order}`,
        type,
        title,
        description: 'Outline',
        keyPoints: [],
        order,
      })),
      generationComplete: true,
    },
  });
  await page.goto(`/classroom/${stageId}`);
  await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
}

const rect = (page: Page, testId: string) => page.getByTestId(testId).boundingBox();

async function persisted(page: Page) {
  return page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}').state ?? {};
    return {
      railW: state.sidebarWidth,
      railCollapsed: state.sidebarCollapsed,
      panelW: state.chatAreaWidth,
      panelCollapsed: state.chatAreaCollapsed,
    };
  }, SETTINGS_KV_KEY);
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Drag the edge handle `testId` by `dx` pixels. */
async function dragEdge(page: Page, testId: string, dx: number) {
  const edge = (await rect(page, testId))!;
  const x = edge.x + edge.width / 2;
  const y = edge.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const;

test.describe('Classroom shell', () => {
  for (const size of SIZES) {
    for (const count of [0, 1, 40]) {
      test(`${size.width}x${size.height} with ${count} scenes: three regions, no sideways scroll`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await openCourse(page, count);
        const stage = (await rect(page, 'stage-box'))!;
        await expectNoSideScroll(page);
        expect(stage.x + stage.width).toBeLessThanOrEqual(size.width + 1);
        expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.02);
        await expect(page.getByTestId('scene-item')).toHaveCount(count);
        const rail = (await rect(page, 'scene-rail'))!;
        const panel = (await rect(page, 'side-panel'))!;
        expect(rail.x).toBeLessThanOrEqual(1);
        expect(rail.x + rail.width).toBeLessThanOrEqual(stage.x + 1);
        expect(panel.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
        expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 1);
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/2.2-${count}-scenes-${THEME}-${size.width}.png`,
          });
        }
      });
    }
  }

  test('stage is at least 60% of the viewport height at 1920x928 with the side panel open', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 928 });
    await openCourse(page, 3);
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false');
    const stage = (await rect(page, 'stage-box'))!;
    expect(stage.height / 928).toBeGreaterThanOrEqual(0.6);
  });

  test('each side region collapses with its one control and remembers it', async ({ page }) => {
    await page.setViewportSize(SIZES[0]);
    await openCourse(page, 5);
    const before = (await rect(page, 'stage-box'))!;
    await expect(page.getByRole('button', { name: 'Hide conversation panel' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Collapse rail' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Hide conversation panel' }).click();
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'true');
    await page.getByRole('button', { name: 'Collapse rail' }).click();
    await expect(page.getByTestId('scene-rail')).toHaveAttribute('data-collapsed', 'true');
    await expect
      .poll(async () => (await rect(page, 'stage-box'))!.width)
      .toBeGreaterThan(before.width);
    await expectNoSideScroll(page);
    expect(await persisted(page)).toMatchObject({ railCollapsed: true, panelCollapsed: true });
    await page.reload();
    await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('scene-rail')).toHaveAttribute('data-collapsed', 'true');
    await page.getByRole('button', { name: 'Show conversation panel' }).click();
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false');
  });

  test('dragging the rail and side panel edges resizes them within limits and survives a reload', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[0]);
    await openCourse(page, 5);
    const rail0 = (await rect(page, 'scene-rail'))!;
    const panel0 = (await rect(page, 'side-panel'))!;

    await dragEdge(page, 'page-rail-resize', 60);
    await dragEdge(page, 'side-panel-resize', -80);
    const rail1 = (await rect(page, 'scene-rail'))!;
    const panel1 = (await rect(page, 'side-panel'))!;
    expect(Math.abs(rail1.width - (rail0.width + 60))).toBeLessThanOrEqual(2);
    expect(Math.abs(panel1.width - (panel0.width + 80))).toBeLessThanOrEqual(2);

    // Far past the limit: clamped, never wider than the cap.
    await dragEdge(page, 'side-panel-resize', -900);
    expect((await rect(page, 'side-panel'))!.width).toBeLessThanOrEqual(560);
    await expectNoSideScroll(page);

    const saved = await persisted(page);
    const rail2 = (await rect(page, 'scene-rail'))!;
    const panel2 = (await rect(page, 'side-panel'))!;
    expect(saved.railW).toBe(Math.round(rail2.width));
    expect(saved.panelW).toBe(Math.round(panel2.width));

    await page.reload();
    await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
    expect(Math.abs((await rect(page, 'scene-rail'))!.width - rail2.width)).toBeLessThanOrEqual(1);
    expect(Math.abs((await rect(page, 'side-panel'))!.width - panel2.width)).toBeLessThanOrEqual(1);
  });
});
