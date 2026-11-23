/**
 * Story 3.5: demo-kit generation behind OPENMAIC_DEMO_KIT=1, driven by recorded
 * model replies (tests/generation/fixtures/demo-kit), no live calls.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  checkDemoSpec,
  ensureDemoOutline,
  generateSceneContent,
  generateWidgetContent,
  validateDemoSpec,
  type AICallFn,
  type DemoSpec,
} from '@openmaic/generation';
import { loadSnippet } from '@/lib/prompts';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';

const FIXTURES = join(__dirname, 'fixtures/demo-kit');
const reply = (name: string) => readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');
const KIT_URL = '/vendor/interactive/demo-kit@1/demo-kit.js';

/** Replays the given replies in order and records every prompt. */
function recorded(...replies: string[]) {
  const calls: { system: string; user: string }[] = [];
  const aiCall: AICallFn = async (system, user) => {
    calls.push({ system, user });
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error(`unexpected call #${calls.length}`);
    return next;
  };
  return { aiCall, calls };
}

/** The spec the stored HTML carries, re-validated. */
function specIn(html: string): DemoSpec {
  const json = html.match(
    /<script type="application\/json" id="demo-spec">([\s\S]*?)<\/script>/,
  )?.[1];
  expect(json).toBeDefined();
  const result = validateDemoSpec(JSON.parse(json!));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

const outline = (over: Partial<SceneOutline> = {}): SceneOutline => ({
  id: 'demo-scene',
  type: 'interactive',
  title: 'Binary place values',
  description: 'Each bit is worth twice the bit to its right.',
  keyPoints: ['A bit is 0 or 1', 'Place values double to the left', 'Add the lit places'],
  order: 2,
  widgetType: 'visualization3d',
  widgetOutline: {
    visualizationType: 'custom',
    concept: 'place values',
    objects: ['four bit cells'],
  },
  ...over,
});

describe('demo-kit routing (OPENMAIC_DEMO_KIT=1)', () => {
  beforeEach(() => vi.stubEnv('OPENMAIC_DEMO_KIT', '1'));
  afterEach(() => vi.unstubAllEnvs());

  test('good scene3d reply (fenced, with a preamble) becomes the kit shell in one call', async () => {
    const { aiCall, calls } = recorded(reply('good-scene3d'));
    const content = (await generateSceneContent(outline(), aiCall)) as GeneratedInteractiveContent;

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain('Demo designer: 3D stage');
    expect(calls[0].system).toContain('`logic-circuit`');
    expect(calls[0].system).not.toMatch(/\{\{/);
    expect(calls[0].user).toContain('Binary place values');
    expect(calls[0].user).toContain('- Place values double to the left');
    expect(calls[0].user).not.toMatch(/\{\{/);
    expect(content.widgetType).toBe('visualization3d');
    expect(content.html).toContain(`<script src="${KIT_URL}"></script>`);
    const spec = specIn(content.html);
    expect(spec.kind).toBe('scene3d');
    expect(spec.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });

  test('good flow reply for a diagram outline uses the flow template', async () => {
    const { aiCall, calls } = recorded(reply('good-flow'));
    const content = await generateWidgetContent(
      outline({
        title: 'TCP handshake',
        widgetType: 'diagram',
        widgetOutline: { diagramType: 'flowchart' },
      }),
      aiCall,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain('Demo designer: animated flow');
    expect(calls[0].user).toContain('Diagram type: flowchart');
    expect(content?.widgetType).toBe('diagram');
    expect(specIn(content!.html).kind).toBe('flow');
  });

  test('good preset request is stored as a preset spec', async () => {
    const { aiCall } = recorded(reply('good-preset'));
    const content = await generateWidgetContent(outline({ title: 'Full adder' }), aiCall);
    const spec = specIn(content!.html);

    expect(spec).toMatchObject({
      kind: 'preset',
      preset: 'logic-circuit',
      params: { circuit: 'full-adder' },
    });
  });

  test('malformed reply is retried once and the corrected reply is used', async () => {
    const { aiCall, calls } = recorded(reply('malformed'), reply('good-scene3d'));
    const content = await generateWidgetContent(outline(), aiCall);

    expect(calls).toHaveLength(2);
    expect(calls[1].system).toBe(calls[0].system);
    expect(calls[1].user).toContain('Your previous reply was rejected');
    expect(calls[1].user).toContain('reply is not a JSON object');
    expect(specIn(content!.html).kind).toBe('scene3d');
  });

  test('schema-invalid twice: errors are fed back, then the matching preset is the fallback', async () => {
    const { aiCall, calls } = recorded(reply('invalid-schema'), reply('invalid-schema'));
    const content = await generateWidgetContent(
      outline({
        title: 'Logic gates',
        description: 'AND, OR and XOR gates combine bits.',
        keyPoints: ['An AND gate needs both inputs', 'XOR is 1 for exactly one input'],
      }),
      aiCall,
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain('objects.2.to: unknown object id "gate9"');
    expect(calls[1].user).toContain(
      'steps.1.checkpoint.answer: answer must be an index into options',
    );
    expect(calls[1].user).toContain('"gate9"'); // the previous reply is quoted back
    expect(specIn(content!.html)).toMatchObject({
      kind: 'preset',
      preset: 'logic-circuit',
      params: {},
    });
  });

  test('fallback with no matching preset walks the key points as a flow', async () => {
    const { aiCall } = recorded(reply('malformed'), reply('malformed'));
    const content = await generateWidgetContent(
      outline({
        title: 'Photosynthesis',
        description: 'How a leaf turns light into sugar.',
        keyPoints: ['Light is absorbed', 'Water is split', 'Sugar is built'],
        widgetOutline: { concept: 'photosynthesis' },
      }),
      aiCall,
    );
    const spec = specIn(content!.html);

    expect(spec.kind).toBe('flow');
    expect(spec.objects.filter((o) => o.type === 'node').map((o) => o.label)).toEqual([
      'Light is absorbed',
      'Water is split',
      'Sugar is built',
    ]);
    expect(spec.steps).toHaveLength(3);
  });

  test('preset with out-of-range params is retried with the param errors', async () => {
    const bad =
      '{"version":1,"kind":"preset","preset":"bit-register","params":{"bits":40},"title":"Bits"}';
    const { aiCall, calls } = recorded(bad, reply('good-preset'));
    await generateWidgetContent(outline(), aiCall);

    expect(calls[1].user).toContain('params.bits');
  });

  test('unknown preset names are rejected', () => {
    const r = checkDemoSpec({ version: 1, kind: 'preset', preset: 'solar-system', title: 'x' });
    expect(r.ok).toBe(false);
  });

  test('simulation stays on the free-form path', async () => {
    const { aiCall, calls } = recorded('<!DOCTYPE html><html><body><p>sim</p></body></html>');
    const content = await generateWidgetContent(
      outline({ widgetType: 'simulation', widgetOutline: { concept: 'x' } }),
      aiCall,
    );

    expect(calls[0].system).not.toContain('DemoSpec');
    expect(content?.html).toContain('<p>sim</p>');
  });
});

describe('demo-kit flag off', () => {
  test('visualization3d keeps the upstream template and model HTML', async () => {
    vi.stubEnv('OPENMAIC_DEMO_KIT', '');
    try {
      const { aiCall, calls } = recorded(
        '<!DOCTYPE html><html><body><canvas id="old-3d"></canvas></body></html>',
      );
      const content = await generateWidgetContent(outline(), aiCall);

      expect(calls).toHaveLength(1);
      expect(calls[0].system).not.toContain('DemoSpec');
      expect(content?.html).toContain('id="old-3d"');
      expect(content?.html).not.toContain('demo-kit');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('prompt examples', () => {
  const root = join(__dirname, '../../packages/@openmaic/generation');
  const files = [
    'templates/demo3d-content/system.md',
    'templates/demoflow-content/system.md',
    'snippets/demo-spec-guide.md',
  ];
  test.each(files)('every json example in %s is a valid spec', (file) => {
    const blocks = [...readFileSync(join(root, file), 'utf8').matchAll(/```json\n([\s\S]*?)```/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, json] of blocks) {
      const r = checkDemoSpec(JSON.parse(json));
      expect(r.ok ? [] : r.errors).toEqual([]);
    }
  });

  test('the outline snippet loads and asks for a visualization3d demo', () => {
    const text = loadSnippet('demo-kit-outline');
    expect(text).toContain('"visualization3d"');
    expect(text).toContain('overrides');
  });
});

describe('ensureDemoOutline', () => {
  const slide = (id: string, order: number): SceneOutline => ({
    id,
    type: 'slide',
    title: `Slide ${id}`,
    description: `About ${id}`,
    keyPoints: [`${id} point`],
    order,
  });
  const quiz: SceneOutline = {
    id: 'q',
    type: 'quiz',
    title: 'Quiz',
    description: '',
    keyPoints: [],
    order: 4,
  };

  test('inserts a visualization3d demo after the first concept slide when none exists', () => {
    const input = [slide('intro', 1), slide('concept', 2), slide('more', 3), quiz];
    const out = ensureDemoOutline(input);

    expect(out.map((o) => o.id)).toEqual(['intro', 'concept', 'concept-demo', 'more', 'q']);
    expect(out.map((o) => o.order)).toEqual([1, 2, 3, 4, 5]);
    expect(out[2]).toMatchObject({
      type: 'interactive',
      widgetType: 'visualization3d',
      title: 'Slide concept',
      keyPoints: ['concept point'],
    });
  });

  test('short lessons get the demo after the first slide', () => {
    expect(ensureDemoOutline([slide('a', 1), quiz]).map((o) => o.id)).toEqual(['a', 'a-demo', 'q']);
  });

  test('an outline that already has a demo is returned unchanged', () => {
    const input = [slide('a', 1), { ...outline(), widgetType: 'diagram' as const, order: 2 }];
    expect(ensureDemoOutline(input)).toBe(input);
  });

  test('a simulation does not count as a demo', () => {
    const input = [slide('a', 1), { ...outline(), widgetType: 'simulation' as const, order: 2 }];
    expect(ensureDemoOutline(input)).toHaveLength(3);
  });
});
