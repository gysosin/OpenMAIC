import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/base';
import { defaultTheme } from '../fixtures/test-data/slide-theme';
import { ClassroomPage } from '../pages/classroom.page';
import { seedServerDocument, uniqueStageId } from '../fixtures/server-seed';

/**
 * Classroom stage fit: the stage box is a true 16:9 and the slide fills it
 * (no 90% studio margin inside a card that is already letterboxed), at three
 * viewports with the conversation panel open and hidden.
 *
 * The slide's own width is read from a text element that spans the whole
 * 1000-unit canvas.
 */

const SLIDE_TEXT = 'Stage fit full-width marker';

async function openCourse(page: Page) {
  const stageId = uniqueStageId('stage-fit-e2e');
  const scenes = [0].map((order) => ({
    id: `${stageId}-s${order}`,
    stageId,
    type: 'slide',
    title: 'Page 1',
    order,
    createdAt: 1785899990000,
    updatedAt: 1785900000000,
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
            content: SLIDE_TEXT,
            left: 0,
            top: 0,
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
      name: 'Stage fit e2e',
      description: 'Stage fit spec fixture',
      createdAt: 1785900000000,
      updatedAt: 1785900000000,
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
  const classroom = new ClassroomPage(page);
  await classroom.goto(stageId);
  await classroom.waitForLoaded();
  await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 10_000 });
}

async function measure(page: Page) {
  const stage = await page.getByTestId('stage-box').boundingBox();
  const marker = await page.getByTestId('stage-box').getByText(SLIDE_TEXT).first().boundingBox();
  expect(stage).not.toBeNull();
  expect(marker).not.toBeNull();
  return { stage: stage!, marker: marker! };
}

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1100, height: 800 },
];

test.describe('Stage fit', () => {
  for (const viewport of VIEWPORTS) {
    for (const panel of ['open', 'hidden'] as const) {
      test(`${viewport.width}x${viewport.height} with the conversation panel ${panel}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await openCourse(page);
        // The fixture can start with the panel either way: drive it to the wanted state.
        const toggle = page.getByRole('button', {
          name: panel === 'open' ? 'Show conversation panel' : 'Hide conversation panel',
        });
        if (await toggle.isVisible()) await toggle.click();
        await expect
          .poll(async () => {
            const { stage } = await measure(page);
            return Math.abs(stage.width / stage.height - 16 / 9);
          })
          .toBeLessThan(0.02);

        // Re-measure until the panel's width transition has settled.
        await expect(async () => {
          const { stage, marker } = await measure(page);
          // Whole stage on screen, slide as wide as its stage.
          expect(stage.x).toBeGreaterThanOrEqual(0);
          expect(stage.x + stage.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(stage.y + stage.height).toBeLessThanOrEqual(viewport.height + 1);
          // The marker is a 1000-wide text box with 10 canvas-px padding per side, so its
          // text spans 98% of a full-bleed slide (a 90% letterbox would give ~88%).
          expect(Math.abs(marker.width - stage.width * 0.98)).toBeLessThanOrEqual(2);
        }).toPass({ timeout: 10_000 });
      });
    }
  }
});
