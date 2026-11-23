/**
 * Demo kit presets, batch 1 (story 3.4): each `kind: "preset"` fixture is
 * expanded by the kit in the browser and rendered at 1280 x 720 in both
 * themes, three steps each, screenshots under test-results/demo-kit-presets/.
 * More preset variants get one dark screenshot each, and the sandbox lab page
 * shows every preset fixture in a sandboxed frame.
 *
 * Same harness as demo-kit.spec.ts: the kit is the built file
 * (`node scripts/build-demo-kit.mjs`) and the shell page is routed.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { buildDemoShell } from '../../packages/@openmaic/generation/src/demo-shell';
import type { DemoSpec } from '../../packages/@openmaic/generation/src/demo-spec';
import {
  DEMO_KIT_URL,
  PRESET_FIXTURES,
  type PresetFixtureName,
} from '../../app/sandbox-lab/demo-kit/fixtures';

const KIT_FILE = resolve(process.cwd(), 'public', `.${DEMO_KIT_URL}`);
const SHOTS = resolve(process.cwd(), 'test-results/demo-kit-presets');

interface KitHandle {
  steps: string[];
  step: string;
  goTo(step: string | number, instant?: boolean): boolean;
}
declare global {
  interface Window {
    demoKit?: KitHandle;
  }
}

async function open(page: Page, spec: DemoSpec, theme: 'light' | 'dark') {
  const kit = await readFile(KIT_FILE, 'utf8');
  const html = buildDemoShell(spec, {
    kitUrl: DEMO_KIT_URL,
    title: spec.title,
    lang: 'en',
  }).replace('<html ', `<html data-theme="${theme}" `);
  await page.route('**/__demo-kit-preset', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route(`**${DEMO_KIT_URL}`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: kit }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/__demo-kit-preset');
  await page.waitForFunction(() => Boolean(window.demoKit));
  return errors;
}

async function show(page: Page, step: string, path: string) {
  expect(await page.evaluate((id) => window.demoKit!.goTo(id), step)).toBe(true);
  // Two frames for the render, then the caption entrance and the cascade.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 900))),
      ),
  );
  expect(await page.evaluate(() => window.demoKit!.step)).toBe(step);
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow).toEqual({ x: 0, y: 0 });
  await page.screenshot({ path });
}

/** Three steps per fixture: an early state, the key move, and a later one. */
const SHOW: Record<PresetFixtureName, string[]> = {
  'preset-bit-register': ['v2', 'v3-invert', 'v3'],
  'preset-logic-circuit': ['row-4', 'quiz', 'row-8'],
  'preset-memory-grid': ['op3-pointer', 'op7-push', 'op8-pop'],
  'preset-data-structure': ['insert-5-path', 'delete-3-successor', 'inorder-8'],
};

for (const name of Object.keys(PRESET_FIXTURES) as PresetFixtureName[]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${name} expands and renders in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = await open(page, PRESET_FIXTURES[name], theme);
      const steps = await page.evaluate(() => window.demoKit!.steps);
      expect(steps).toEqual(expect.arrayContaining(SHOW[name]));
      await expect(page.getByText(PRESET_FIXTURES[name].title).first()).toBeVisible();
      for (const step of SHOW[name])
        await show(page, step, `${SHOTS}/${name}-${theme}-${step}.png`);
      expect(errors).toEqual([]);
    });
  }
}

const preset = (name: string, params: Record<string, unknown>): DemoSpec => ({
  version: 1,
  kind: 'preset',
  preset: name,
  params,
  title: '',
  objects: [],
  steps: [],
  controls: [],
});

const VARIANTS: [string, DemoSpec, string][] = [
  ['counting-16', preset('bit-register', { bits: 16 }), 'v10'],
  ['bytes-16', preset('bit-register', { bits: 16, mode: 'byte-groups' }), 'v4'],
  ['powers-4', preset('bit-register', { bits: 4, mode: 'powers-of-two' }), 'v5'],
  ['not', preset('logic-circuit', { circuit: 'not' }), 'row-1'],
  ['nand', preset('logic-circuit', { circuit: 'nand' }), 'row-4'],
  ['half-adder', preset('logic-circuit', { circuit: 'half-adder' }), 'row-4'],
  ['mux', preset('logic-circuit', { circuit: '2-to-1-mux' }), 'row-6'],
  ['sr-latch', preset('logic-circuit', { circuit: 'sr-latch' }), 'hold-1'],
  [
    'memory-64',
    preset('memory-grid', {
      cells: 64,
      wordSize: 8,
      ops: [
        { op: 'store', cell: 3, value: 1, name: 'n' },
        { op: 'pointer', cell: 10, to: 3, name: 'p' },
        { op: 'frame', name: 'main', locals: ['a', 'b'] },
        { op: 'frame', name: 'f', locals: ['x'] },
        { op: 'push', value: 9 },
      ],
    }),
    'op5-push',
  ],
  ['array', preset('data-structure', { structure: 'array' }), 'insert-9-shift'],
  ['linked-list', preset('data-structure', { structure: 'linked-list' }), 'insert-4-new'],
  ['linked-list-delete', preset('data-structure', { structure: 'linked-list' }), 'delete-8-bypass'],
  ['stack', preset('data-structure', { structure: 'stack' }), 'delete-2'],
  ['queue', preset('data-structure', { structure: 'queue' }), 'delete-4-done'],
  ['hash-table', preset('data-structure', { structure: 'hash-table' }), 'insert-19'],
];

for (const [label, spec, step] of VARIANTS) {
  test(`variant ${label} renders`, async ({ page }) => {
    const errors = await open(page, spec, 'dark');
    await show(page, step, `${SHOTS}/variant-${label}-${step}.png`);
    expect(errors).toEqual([]);
  });
}

test('the sandbox lab shows every preset fixture in a sandboxed frame', async ({ page }) => {
  test.setTimeout(120_000);
  const response = await page.goto('/sandbox-lab/demo-kit');
  test.skip(response?.status() === 404, 'OPENMAIC_SANDBOX_LAB is not enabled on this server');
  for (const name of Object.keys(PRESET_FIXTURES) as PresetFixtureName[]) {
    const frame = page.frameLocator(`iframe[data-fixture="${name}"]`);
    await expect(frame.getByRole('button', { name: 'Next step' })).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText(PRESET_FIXTURES[name].title).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'op3-pointer' }).click();
  await expect(page.getByTestId('demo-log')).toBeVisible();
});
