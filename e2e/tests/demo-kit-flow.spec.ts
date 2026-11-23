/**
 * Demo kit flow engine (story 3.3): both flow fixtures at 1280 x 720 in both
 * themes with one screenshot per step under test-results/demo-kit-flow/, the
 * 5 / 12 / 30 node sizes, the token on the right node at every step, forward /
 * back / scrub landing on the same picture, no scrollbars, the render loop
 * sleeping while hidden, and click-to-ask from a sandboxed frame.
 *
 * Like demo-kit.spec.ts, the kit is served from the built file
 * (`node scripts/build-demo-kit.mjs`) and the pages are routed.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { buildDemoShell } from '../../packages/@openmaic/generation/src/demo-shell';
import { CPU_FSM, DEMO_KIT_URL, HTTP_LIFECYCLE, stressFlow } from '../../app/sandbox-lab/demo-kit/fixtures';
import type { DemoSpec } from '../../packages/@openmaic/generation/src/demo-spec';

const KIT_FILE = resolve(process.cwd(), 'public', `.${DEMO_KIT_URL}`);
const SHOTS = resolve(process.cwd(), 'test-results/demo-kit-flow');

const PIPELINE: DemoSpec = {
  version: 1,
  kind: 'flow',
  title: 'Build pipeline',
  objects: [
    ...(['Commit', 'Build', 'Test', 'Package', 'Deploy'] as const).map((label, i) => ({
      id: `p${i}`,
      type: 'node' as const,
      label,
      icon: (['file', 'gear', 'check', 'memory', 'cloud'] as const)[i],
    })),
    ...[0, 1, 2, 3].map((i) => ({ id: `q${i}`, type: 'edge' as const, from: `p${i}`, to: `p${i + 1}` })),
    { id: 'job', type: 'token', from: 'p0', label: 'v1.4.2' },
  ],
  steps: [
    { id: 'push', caption: 'A commit lands on main', highlight: ['p0'] },
    { id: 'build', caption: 'The build compiles it', travel: { job: 'q0' } },
    { id: 'test', caption: 'Tests run against the build', travel: { job: 'q1' } },
  ],
  controls: [],
};

const SPECS: Record<string, DemoSpec> = {
  'http-lifecycle': HTTP_LIFECYCLE,
  'cpu-fsm': CPU_FSM,
  'pipeline-5': PIPELINE,
  'stress-30': stressFlow(30),
};

interface Inspect {
  nodes: Record<string, { x: number; y: number; w: number; h: number }>;
  tokens: Record<string, { x: number; y: number; visible: boolean; at: string | null }>;
  active: string[];
  viewBox: string;
}
interface KitHandle {
  steps: string[];
  step: string;
  looping: boolean;
  goTo(step: string | number, instant?: boolean): boolean;
  inspect(): Inspect;
}
declare global {
  interface Window {
    demoKit?: KitHandle;
    hostMessages?: Record<string, unknown>[];
  }
}

function shell(spec: DemoSpec, theme: 'light' | 'dark') {
  return buildDemoShell(spec, { kitUrl: DEMO_KIT_URL, title: spec.title, lang: 'en' }).replace(
    '<html ',
    `<html data-theme="${theme}" `,
  );
}

async function serveKit(page: Page) {
  const kit = await readFile(KIT_FILE, 'utf8');
  await page.route(`**${DEMO_KIT_URL}`, (route) => route.fulfill({ contentType: 'text/javascript', body: kit }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  return errors;
}

async function open(page: Page, name: string, theme: 'light' | 'dark', reducedMotion = false) {
  const errors = await serveKit(page);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/__flow-fixture', (route) => route.fulfill({ contentType: 'text/html', body: shell(SPECS[name], theme) }));
  await page.goto('/__flow-fixture');
  await page.waitForFunction(() => Boolean(window.demoKit));
  return errors;
}

async function settle(page: Page, ms = 600) {
  await page.evaluate(
    (wait) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, wait)))),
    ms,
  );
}

const inspect = (page: Page) => page.evaluate(() => window.demoKit!.inspect());

/** Every node lies inside the visible SVG box and the page never scrolls. */
async function expectFitted(page: Page) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow).toEqual({ x: 0, y: 0 });
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.fl-node')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.id, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );
  const svg = await page.locator('.fl-svg').boundingBox();
  for (const b of boxes) {
    expect(b.left, b.id).toBeGreaterThanOrEqual(svg!.x - 1);
    expect(b.right, b.id).toBeLessThanOrEqual(svg!.x + svg!.width + 1);
    expect(b.top, b.id).toBeGreaterThanOrEqual(svg!.y - 1);
    expect(b.bottom, b.id).toBeLessThanOrEqual(svg!.y + svg!.height + 1);
  }
}

/** The token sits just above the node the model says it is on. */
function expectDocked(view: Inspect, token: string) {
  const t = view.tokens[token];
  if (!t.at) return;
  const node = view.nodes[t.at];
  expect(t.visible).toBe(true);
  expect(t.y).toBeLessThan(node.y);
  expect(t.y).toBeGreaterThan(node.y - 24);
  expect(t.x).toBeGreaterThanOrEqual(node.x);
  expect(t.x).toBeLessThanOrEqual(node.x + node.w);
}

for (const name of ['http-lifecycle', 'cpu-fsm'] as const) {
  const token = name === 'http-lifecycle' ? 'pkt' : 'ins';
  for (const theme of ['dark', 'light'] as const) {
    test(`${name} renders every step in ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = await open(page, name, theme);
      const steps = await page.evaluate(() => window.demoKit!.steps);
      expect(steps).toEqual(SPECS[name].steps!.map((s) => s.id));
      await settle(page, 1400); // the intro
      for (const [index, step] of steps.entries()) {
        // Animated, as a learner sees it: the token rides the edge into place.
        expect(await page.evaluate((id) => window.demoKit!.goTo(id, false), step)).toBe(true);
        await settle(page, index === 0 ? 300 : 2200);
        expect(await page.evaluate(() => window.demoKit!.step)).toBe(step);
        const view = await inspect(page);
        expectDocked(view, token);
        await expectFitted(page);
        await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${String(index + 1).padStart(2, '0')}-${step}.png` });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('5, 12 and 30 node flows fit 1280 x 720 in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  for (const name of ['pipeline-5', 'cpu-fsm', 'stress-30']) {
    for (const theme of ['dark', 'light'] as const) {
      await page.unrouteAll();
      const errors = await open(page, name, theme);
      const last = SPECS[name].steps!.length - 1;
      await page.evaluate((i) => window.demoKit!.goTo(i), last);
      await settle(page, 1400);
      await expectFitted(page);
      expectDocked(await inspect(page), name === 'pipeline-5' ? 'job' : name === 'cpu-fsm' ? 'ins' : 'tok');
      await page.screenshot({ path: `${SHOTS}/size-${name}-${theme}.png` });
      expect(errors).toEqual([]);
    }
  }
});

test('forward, back and scrub land on the same picture', async ({ page }) => {
  await open(page, 'http-lifecycle', 'dark');
  await settle(page, 1200);
  const next = page.getByRole('button', { name: 'Next step' });
  for (let i = 0; i < 4; i++) {
    await next.click();
    await settle(page, 2600);
  }
  expect(await page.evaluate(() => window.demoKit!.step)).toBe('request');
  const forward = await inspect(page);
  // Jump to the end with the scrubber, then step back one at a time with the keyboard.
  await page.evaluate(() => {
    const scrub = document.querySelector<HTMLInputElement>('.dk-scrub')!;
    scrub.value = '1000';
    scrub.dispatchEvent(new Event('input'));
    scrub.dispatchEvent(new Event('change'));
  });
  await settle(page, 400);
  expect(await page.evaluate(() => window.demoKit!.step)).toBe('render');
  expectDocked(await inspect(page), 'pkt');
  expect((await inspect(page)).tokens.pkt.at).toBe('browser');
  // Going back replays a transition at its own length (a travel takes up to ~2.5 s).
  for (const step of ['respond', 'check', 'rows', 'query', 'request']) {
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => page.evaluate(() => window.demoKit!.step), { timeout: 5000 }).toBe(step);
    await settle(page, 2600);
  }
  const back = await inspect(page);
  expect(back.tokens.pkt.at).toBe('server');
  expect(back.tokens.pkt.x).toBeCloseTo(forward.tokens.pkt.x, 1);
  expect(back.tokens.pkt.y).toBeCloseTo(forward.tokens.pkt.y, 1);
  expect(back.active).toEqual(forward.active);
  // The same step reached instantly matches too.
  await page.evaluate(() => window.demoKit!.goTo('type'));
  await page.evaluate(() => window.demoKit!.goTo('request'));
  const jumped = await inspect(page);
  expect(jumped.tokens.pkt.x).toBeCloseTo(forward.tokens.pkt.x, 1);
  expect(jumped.tokens.pkt.y).toBeCloseTo(forward.tokens.pkt.y, 1);
});

test('reduced motion steps without tweening', async ({ page }) => {
  const errors = await open(page, 'http-lifecycle', 'light', true);
  await page.getByRole('button', { name: 'Next step' }).click();
  await settle(page, 50);
  expect(await page.evaluate(() => window.demoKit!.step)).toBe('dns');
  expectDocked(await inspect(page), 'pkt');
  expect((await inspect(page)).tokens.pkt.at).toBe('dns');
  expect(errors).toEqual([]);
});

test('the flow stops its frame loop while hidden', async ({ page }) => {
  await open(page, 'cpu-fsm', 'dark');
  expect(await page.evaluate(() => window.demoKit!.looping)).toBe(true);
  await page.evaluate(() => (document.body.style.display = 'none'));
  await expect.poll(() => page.evaluate(() => window.demoKit!.looping)).toBe(false);
  await page.evaluate(() => (document.body.style.display = ''));
  await expect.poll(() => page.evaluate(() => window.demoKit!.looping)).toBe(true);
});

test('clicking a node or an edge in a sandboxed frame asks about it', async ({ page }) => {
  await serveKit(page);
  const html = shell(HTTP_LIFECYCLE, 'dark');
  await page.route('**/__flow-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
<iframe id="demo" sandbox="allow-scripts" style="width:1280px;height:720px;border:0"></iframe>
<script>
window.hostMessages = [];
window.addEventListener('message', (e) => { if (e.data && e.data.source === 'demo-kit') window.hostMessages.push(e.data); });
</script></body></html>`,
    }),
  );
  await page.goto('/__flow-host');
  await page.evaluate((srcdoc) => ((document.getElementById('demo') as HTMLIFrameElement).srcdoc = srcdoc), html);
  const frame = page.frameLocator('#demo');
  await expect(frame.locator('#tls')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await frame.locator('#tls .fl-top').click();
  await expect
    .poll(() => page.evaluate(() => window.hostMessages!.filter((m) => m.type === 'DEMO_ASK')))
    .toEqual([
      {
        source: 'demo-kit',
        type: 'DEMO_ASK',
        objectId: 'tls',
        label: 'TLS handshake',
        ask: 'Agrees on keys so the rest of the exchange is encrypted',
        step: 'type',
      },
    ]);
  // An edge label is part of its edge.
  await frame.locator('.fl-elabels [data-id="e8"]').click();
  await expect
    .poll(() => page.evaluate(() => window.hostMessages!.filter((m) => m.type === 'DEMO_ASK').map((m) => m.objectId)))
    .toEqual(['tls', 'e8']);
  // Keyboard: a focused node asks on Enter.
  await frame.locator('#db').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.hostMessages!.filter((m) => m.type === 'DEMO_ASK').map((m) => m.objectId)))
    .toEqual(['tls', 'e8', 'db']);
  // The host can drive the frame to a step.
  await page.evaluate(() =>
    (document.getElementById('demo') as HTMLIFrameElement).contentWindow!.postMessage(
      { type: 'SET_WIDGET_STATE', state: { step: 'tls' } },
      '*',
    ),
  );
  await expect(frame.locator('.dk-count')).toHaveText('4 / 10', { timeout: 10_000 });
});
