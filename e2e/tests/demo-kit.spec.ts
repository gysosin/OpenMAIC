/**
 * Demo kit (story 3.2): each fixture spec rendered at 1280 x 720 in both
 * themes, one screenshot per step under test-results/demo-kit/, plus the
 * behaviours the classroom relies on (no scrollbars, render loop stops while
 * hidden, host messages from anyone but the parent are ignored, and the lab
 * page drives a sandboxed frame through SET_WIDGET_STATE).
 *
 * The kit is served from the built file (`node scripts/build-demo-kit.mjs`);
 * the shell page is routed, so these tests do not depend on app pages.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { buildDemoShell } from '../../packages/@openmaic/generation/src/demo-shell';
import { DEMO_FIXTURES, DEMO_KIT_URL, type DemoFixtureName } from '../../app/sandbox-lab/demo-kit/fixtures';

const KIT_FILE = resolve(process.cwd(), 'public', `.${DEMO_KIT_URL}`);
const SHOTS = resolve(process.cwd(), 'test-results/demo-kit');

interface KitHandle {
  steps: string[];
  step: string;
  looping: boolean;
  goTo(step: string | number, instant?: boolean): boolean;
}
declare global {
  interface Window {
    demoKit?: KitHandle;
  }
}

async function openFixture(page: Page, name: DemoFixtureName, theme: 'light' | 'dark') {
  const kit = await readFile(KIT_FILE, 'utf8');
  await page.route('**/__demo-kit-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: buildDemoShell(DEMO_FIXTURES[name], { kitUrl: DEMO_KIT_URL, title: name, lang: 'en' }).replace(
        '<html ',
        `<html data-theme="${theme}" `,
      ),
    }),
  );
  await page.route(`**${DEMO_KIT_URL}`, (route) => route.fulfill({ contentType: 'text/javascript', body: kit }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/__demo-kit-fixture');
  await page.waitForFunction(() => Boolean(window.demoKit));
  return errors;
}

async function settle(page: Page) {
  // Two animation frames for the render, then the caption entrance (0.42 s).
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 500)))),
  );
}

for (const name of Object.keys(DEMO_FIXTURES) as DemoFixtureName[]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${name} renders every step in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = await openFixture(page, name, theme);
      const steps = await page.evaluate(() => window.demoKit!.steps);
      expect(steps).toEqual((DEMO_FIXTURES[name].steps ?? []).map((s) => s.id));
      for (const [index, step] of steps.entries()) {
        expect(await page.evaluate((id) => window.demoKit!.goTo(id), step)).toBe(true);
        await settle(page);
        expect(await page.evaluate(() => window.demoKit!.step)).toBe(step);
        const overflow = await page.evaluate(() => ({
          x: document.documentElement.scrollWidth - window.innerWidth,
          y: document.documentElement.scrollHeight - window.innerHeight,
        }));
        expect(overflow).toEqual({ x: 0, y: 0 });
        await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${index + 1}-${step}.png` });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('steps forward and back with the transport and keyboard', async ({ page }) => {
  await openFixture(page, 'half-adder', 'dark');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(() => page.evaluate(() => window.demoKit!.step)).toBe('s2');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.demoKit!.step)).toBe('s3');
  await expect(page.getByText('What is the carry bit now?').first()).toBeVisible();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect.poll(() => page.evaluate(() => window.demoKit!.step)).toBe('s2');
});

test('the render loop stops while the stage is hidden', async ({ page }) => {
  await openFixture(page, 'bit-register', 'dark');
  expect(await page.evaluate(() => window.demoKit!.looping)).toBe(true);
  await page.evaluate(() => (document.body.style.display = 'none'));
  await expect.poll(() => page.evaluate(() => window.demoKit!.looping)).toBe(false);
  await page.evaluate(() => (document.body.style.display = ''));
  await expect.poll(() => page.evaluate(() => window.demoKit!.looping)).toBe(true);
});

test('ignores host messages that do not come from the parent window', async ({ page }) => {
  await openFixture(page, 'half-adder', 'dark');
  await page.evaluate(() => window.postMessage({ type: 'SET_WIDGET_STATE', state: { step: 's4' } }, '*'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.demoKit!.step)).toBe('s1');
});

test('the sandbox lab drives a sandboxed demo frame', async ({ page }) => {
  const response = await page.goto('/sandbox-lab/demo-kit');
  test.skip(response?.status() === 404, 'OPENMAIC_SANDBOX_LAB is not enabled on this server');
  const frame = page.frameLocator('iframe[data-fixture="half-adder"]');
  await expect(frame.getByRole('button', { name: 'Next step' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 's4' }).first().click();
  // The half adder is the first srcdoc frame on the page.
  const halfAdder = page.frame({ url: 'about:srcdoc' })!;
  await expect.poll(() => halfAdder.evaluate(() => window.demoKit?.step)).toBe('s4');
  await frame.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByTestId('demo-log')).toContainText('"type":"DEMO_STEP_CHANGED","step":"s5"');
});
