import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/base';
import { defaultTheme } from '../fixtures/test-data/slide-theme';
import { SETTINGS_KV_KEY, createSettingsStorage } from '../fixtures/test-data/settings';
import { seedServerDocument, setCurrentScene, uniqueStageId } from '../fixtures/server-seed';

/**
 * Story 2.3: the agent dock (avatars, mic, text input) is the foot of the side panel's Chat
 * tab. Under the stage there is only the transport bar; the stage keeps the height the dock
 * used to take. A discussion still starts, pauses and ends, and a folded panel keeps an entry.
 */

const SHOTS = process.env.SHOTS_DIR;
const THEME = process.env.SHOT_THEME ?? 'light';

async function openCourse(page: Page, panelCollapsed: boolean) {
  await page.addInitScript(
    ([key, value, theme]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      localStorage.setItem('locale', 'en-US');
      localStorage.setItem('theme', theme);
    },
    [
      SETTINGS_KV_KEY,
      createSettingsStorage({
        ttsMuted: true,
        autoPlayLecture: false,
        sidebarCollapsed: false,
        chatAreaCollapsed: panelCollapsed,
      }),
      THEME,
    ],
  );
  await page.goto('/classroom/warmup-nonexistent');
  const stageId = uniqueStageId('chat-dock');
  const sceneId = `${stageId}-s0`;
  const now = Date.now();
  await seedServerDocument(page, {
    stage: { id: stageId, name: 'Chat dock', createdAt: now, updatedAt: now },
    scenes: [
      {
        id: sceneId,
        stageId,
        type: 'slide',
        title: 'Chat dock',
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
                content: 'Chat dock slide',
                left: 0,
                top: 0,
                width: 1000,
                height: 100,
              },
            ],
          },
        },
        actions: [
          { id: 'first', type: 'speech', text: 'The lecture sentence that is playing now.' },
          { id: 'second', type: 'speech', text: 'The next sentence must wait for play.' },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  await setCurrentScene(page, stageId, sceneId);
  await page.goto(`/classroom/${stageId}`);
  await expect(page.getByTestId('stage-box')).toBeVisible({ timeout: 45_000 });
}

type ChatRequest = { messages: Array<{ role: string; parts: Array<{ text?: string }> }> };

async function mockChat(page: Page, opts: { gate?: Promise<void>; options?: string[] } = {}) {
  const requests: ChatRequest[] = [];
  await page.route('**/api/chat/pi', async (route) => {
    requests.push(route.request().postDataJSON());
    await opts.gate;
    const id = `answer-${requests.length}`;
    const reply = 'Which example should we try?';
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        {
          type: 'agent_start',
          data: { messageId: id, agentId: 'default-1', agentName: 'Teacher' },
        },
        { type: 'text_delta', data: { messageId: id, content: reply } },
        { type: 'agent_end', data: { messageId: id, agentId: 'default-1' } },
        {
          type: 'cue_user',
          data: {
            fromAgentId: 'default-1',
            prompt: reply,
            ...(opts.options ? { options: opts.options } : {}),
          },
        },
        {
          type: 'done',
          data: {
            totalActions: 0,
            totalAgents: 1,
            agentHadContent: true,
            cueUserReceived: true,
            directorState: { turnCount: requests.length, agentResponses: [], whiteboardLedger: [] },
          },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    });
  });
  return requests;
}

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe('Chat dock in the side panel', () => {
  test('the canvas keeps the height the dock used to take, panel open', async ({ page }) => {
    const sizes = [
      { width: 1920, height: 1080 },
      { width: 1920, height: 928 },
      { width: 1366, height: 768 },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await openCourse(page, false);
      await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false');
      const stage = await box(page, 'stage-box');
      const canvas = (await page.locator('div.isolate').first().boundingBox())!;
      const bar = await box(page, 'roundtable-region');
      console.log(
        `MEASURE ${size.width}x${size.height} stage=${stage.width.toFixed(1)}x${stage.height.toFixed(1)} canvas=${canvas.height.toFixed(1)} under=${(size.height - (canvas.y + canvas.height)).toFixed(1)} bar=${bar.height}`,
      );
      // Whatever sits under the canvas is the transport bar and the caption band.
      expect(size.height - (canvas.y + canvas.height)).toBeLessThanOrEqual(44 + 48 + 1);
    }
  });

  test('the transport bar is the only bar under the stage; mic and input live in the Chat tab', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openCourse(page, false);
    const requests = await mockChat(page);

    // No dock under the stage: the region is one bar, and the stage column holds no avatars.
    const region = await box(page, 'roundtable-region');
    expect(region.height).toBeLessThanOrEqual(48);
    const stage = await box(page, 'stage-box');
    const panel = await box(page, 'side-panel');
    expect(region.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(region.x + region.width).toBeLessThanOrEqual(panel.x + 1);

    // Notes is the default tab: the dock is the Chat tab's.
    await expect(page.getByTestId('chat-dock')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Chat' }).click();
    const dock = page.getByTestId('chat-dock');
    await expect(dock).toBeVisible();
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.x).toBeGreaterThanOrEqual(panel.x - 1);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    await expect(dock.getByRole('button', { name: /^Voice input/ })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'You' })).toBeVisible();

    // The text input works from there and sends a normal message.
    await dock.getByRole('button', { name: 'Text input' }).click();
    const textarea = dock.getByPlaceholder('Type your message...', { exact: true });
    await expect(textarea).toBeVisible();
    await textarea.fill('Can you show an example?');
    await textarea.press('Enter');
    await expect.poll(() => requests.length).toBe(1);
    expect(JSON.stringify(requests[0])).toContain('Can you show an example?');
    await expect(
      page.getByTestId('side-panel').getByText('Which example should we try?'),
    ).toBeVisible();

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/2.3-chat-tab-${THEME}-1920.png` });
  });

  test('a discussion starts from the dock, pauses the lecture and ends from the transport bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openCourse(page, false);
    await mockChat(page);
    await page.getByRole('tab', { name: 'Chat' }).click();
    const dock = page.getByTestId('chat-dock');

    // Start the lecture, then open the input: the lecture pauses.
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await dock.getByRole('button', { name: 'Text input' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();

    // Send: the discussion runs, the stop control shows, and stopping it ends it.
    const textarea = dock.getByPlaceholder('Type your message...', { exact: true });
    await textarea.fill('Explain this please');
    await textarea.press('Enter');
    const stop = page.getByRole('button', { name: 'Stop Discussion' });
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(dock).toBeVisible();
  });

  test('a folded side panel keeps a Chat entry in the transport bar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openCourse(page, true);
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('chat-dock')).toHaveCount(0);

    const open = page.getByTestId('roundtable-region').getByTestId('open-chat');
    await expect(open).toBeVisible();
    await open.click();
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false');
    await expect(page.getByTestId('chat-dock')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('data-state', 'active');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/2.3-opened-from-bar-${THEME}-1366.png` });
  });

  test('a cue to the learner opens the Chat tab on its own when the panel is folded', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openCourse(page, false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const options = ['Show an example', 'Keep going'];
    const requests = await mockChat(page, { gate, options });
    await page.getByRole('tab', { name: 'Chat' }).click();
    const dock = page.getByTestId('chat-dock');
    await dock.getByRole('button', { name: 'Text input' }).click();
    const textarea = dock.getByPlaceholder('Type your message...', { exact: true });
    await textarea.fill('Quiz me');
    await textarea.press('Enter');
    await expect.poll(() => requests.length).toBe(1);

    // Fold the panel while the agent is still answering, then let the cue arrive.
    await page.getByRole('button', { name: 'Hide conversation panel' }).click();
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'true');
    release();

    // No click: the panel opens on the Chat tab and the options are there.
    // The reply streams in first, so the cue takes a few seconds.
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false', {
      timeout: 25_000,
    });
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('data-state', 'active');
    const replies = page.getByTestId('cue-user-options');
    await expect(replies).toBeVisible();
    await expect(replies.getByRole('button')).toHaveCount(options.length);
  });

  test('the T key opens the Chat tab with the input from a folded panel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openCourse(page, true);
    await page.keyboard.press('T');
    await expect(page.getByTestId('side-panel')).toHaveAttribute('data-collapsed', 'false');
    await expect(
      page.getByTestId('chat-dock').getByPlaceholder('Type your message...', { exact: true }),
    ).toBeFocused();
  });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    test(`${size.width}x${size.height}: no sideways scroll, the dock fits the panel`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openCourse(page, false);
      await page.getByRole('tab', { name: 'Chat' }).click();
      await page.getByTestId('chat-dock').getByRole('button', { name: 'Text input' }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const dock = await box(page, 'chat-dock');
      const panel = await box(page, 'side-panel');
      expect(dock.x + dock.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
      expect(dock.y + dock.height).toBeLessThanOrEqual(size.height + 1);
      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/2.3-input-open-${THEME}-${size.width}.png` });
      }
    });
  }
});
