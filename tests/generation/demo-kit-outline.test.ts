/**
 * Story 3.5, outline step: with OPENMAIC_DEMO_KIT off the outline prompt and
 * outlines are exactly upstream's; with it on, the only prompt change is the
 * appended demo snippet and an outline without a demo gets one.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createLogger } from '@/lib/logger';
import { loadSnippet } from '@/lib/prompts';
import type { UserRequirements } from '@/lib/types/generation';

const streamLLMMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/llm', () => ({ streamLLM: streamLLMMock }));

const MODEL = {
  model: { provider: 'test.chat', modelId: 'test-model' },
  modelInfo: { outputWindow: 4096, capabilities: {} },
  modelString: 'test:test-model',
  providerId: 'test',
  modelId: 'test-model',
  thinkingConfig: undefined,
};

const slide = (n: number) => ({
  id: `s${n}`,
  type: 'slide',
  title: `Slide ${n}`,
  description: `About ${n}`,
  keyPoints: [`point ${n}`],
  order: n,
});

/** Run the outline step on a stubbed model; return the system prompt and outlines. */
async function run(flag: string) {
  vi.stubEnv('OPENMAIC_DEMO_KIT', flag);
  streamLLMMock.mockReset();
  const reply = JSON.stringify({
    languageDirective: 'Teach in English.',
    outlines: [slide(1), slide(2), slide(3)],
  });
  streamLLMMock.mockReturnValue({
    fullStream: (async function* () {
      yield { type: 'text-delta', text: reply };
      yield { type: 'finish', finishReason: 'stop' };
    })(),
  });
  const { generateOutlines } = await import('@/lib/server/generation/steps/outline');
  const result = await generateOutlines(
    {
      requirements: { requirement: 'Teach binary numbers' } as unknown as UserRequirements,
      pdfText: '',
      pdfImages: [],
      imageMapping: {},
      researchContext: '',
      model: MODEL as never,
    },
    {
      log: createLogger('Outline'),
      workspaceId: null,
      resolveVisionImages: async (images) => [...images],
    },
  );
  const { system } = streamLLMMock.mock.calls[0][0] as { system: string };
  return { system, outlines: result.outlines };
}

describe('outline step with the demo-kit flag', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('off: prompt has no demo rule and outlines are untouched; on: only the snippet is appended', async () => {
    const off = await run('');
    const on = await run('1');

    expect(off.system).not.toContain('Demo rule');
    expect(on.system).toBe(`${off.system}\n\n${loadSnippet('demo-kit-outline')}`);
    expect(off.outlines.map((o) => o.id)).toEqual(['s1', 's2', 's3']);
    expect(on.outlines.map((o) => o.id)).toEqual(['s1', 's2', 's2-demo', 's3']);
    expect(on.outlines[2]).toMatchObject({ type: 'interactive', widgetType: 'visualization3d' });
  });
});
