/**
 * Story 3.5 dry check: scene HTML produced by the demo-kit generation path
 * (recorded model replies, no live calls) loads the kit inside the classroom's
 * iframe patch (patchHtmlForIframe) in a sandboxed frame, plays to a later
 * step, and is screenshotted under test-results/demo-kit-generated/.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const require = createRequire(process.cwd() + '/package.json');
const { buildSync } = require(
  createRequire(require.resolve('tsx/package.json')).resolve('esbuild'),
);
const patchBundle: string = buildSync({
  entryPoints: ['lib/utils/iframe.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'IframeUtils',
}).outputFiles[0].text;

const KIT_URL = '/vendor/interactive/demo-kit@1/demo-kit.js';
const KIT_FILE = resolve(process.cwd(), 'public', `.${KIT_URL}`);
const FIXTURES = resolve(process.cwd(), 'tests/generation/fixtures/demo-kit');
const SHOTS = resolve(process.cwd(), 'test-results/demo-kit-generated');

interface KitHandle {
  steps: string[];
  step: string;
  goTo(step: string | number, instant?: boolean): boolean;
}
declare global {
  interface Window {
    demoKit?: KitHandle;
    IframeUtils: { patchHtmlForIframe(html: string): string };
  }
}

const CASES: [string, 'visualization3d' | 'diagram', string[]][] = [
  ['good-scene3d', 'visualization3d', []],
  ['good-flow', 'diagram', []],
  ['good-preset', 'visualization3d', []],
  // Two malformed replies: the stored scene is the key-point flow fallback.
  ['fallback', 'visualization3d', ['malformed', 'malformed']],
];

/**
 * The scene HTML from generateDemoContent with recorded replies. @openmaic/generation
 * is ESM-only and Playwright loads specs as CommonJS, so it runs in a child node.
 */
function generate(id: string, widgetType: string, replies: string[]): string {
  const script = `
import { readFileSync } from 'node:fs';
import { generateDemoContent } from '@openmaic/generation';
const [id, widgetType, fixtures, ...replies] = process.argv.slice(1);
const aiCall = async () => readFileSync(fixtures + '/' + replies.shift() + '.txt', 'utf8');
const content = await generateDemoContent({
  id, type: 'interactive', title: 'Generated demo',
  description: 'How a leaf turns light into sugar.',
  keyPoints: ['Light is absorbed', 'Water is split', 'Sugar is built'],
  order: 1, widgetType, widgetOutline: {},
}, aiCall);
process.stdout.write(content.html);`;
  return execFileSync(
    'node',
    ['--input-type=module', '-e', script, id, widgetType, FIXTURES, ...replies],
    { encoding: 'utf8' },
  );
}

for (const [name, widgetType, replies] of CASES) {
  test(`generated ${name} scene loads the kit in the classroom frame`, async ({ page }) => {
    test.setTimeout(120_000);
    const html = generate(name, widgetType, replies.length ? replies : [name]);
    expect(html).toContain(`<script src="${KIT_URL}"></script>`);

    await page.route('**/__demo-generated', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body style="margin:0"></body>',
      }),
    );
    await page.route(`**${KIT_URL}`, (route) =>
      route.fulfill({ contentType: 'text/javascript', body: readFileSync(KIT_FILE, 'utf8') }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/__demo-generated');
    await page.evaluate(`${patchBundle};window.IframeUtils=IframeUtils;`);
    await page.evaluate((html) => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
      f.style.cssText = 'border:0;width:1280px;height:720px;display:block';
      f.srcdoc = window.IframeUtils.patchHtmlForIframe(html);
      document.body.appendChild(f);
    }, html);

    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    await frame.waitForFunction(() => Boolean(window.demoKit), undefined, { timeout: 30_000 });
    const steps = await frame.evaluate(() => window.demoKit!.steps);
    expect(steps.length).toBeGreaterThan(1);
    const later = steps[Math.min(2, steps.length - 1)];
    expect(await frame.evaluate((id) => window.demoKit!.goTo(id), later)).toBe(true);
    await page.waitForTimeout(1200);
    expect(await frame.evaluate(() => window.demoKit!.step)).toBe(later);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  });
}
