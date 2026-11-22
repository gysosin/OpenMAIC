import { describe, expect, it } from 'vitest';
import { getModel, getModelInfo, getProvider } from '@/lib/ai/providers';
import { resolveThinkingProviderOptions } from '@/lib/ai/llm';
import { getProviderPreset } from '@/lib/config/provider-presets';
import { parseModelConfig } from '@/lib/server/model-config/openmaic-yml';

describe('claude-cli registration', () => {
  it('getModel builds a CLI-backed model with outputWindow set', () => {
    const { model, modelInfo } = getModel({
      providerId: 'claude-cli',
      modelId: 'sonnet',
      apiKey: '',
    });
    expect(model).toMatchObject({ provider: 'claude-cli', modelId: 'sonnet' });
    expect(modelInfo?.outputWindow).toBeGreaterThan(4096);
    expect(modelInfo?.capabilities).toMatchObject({ tools: false, vision: false, streaming: true });
  });

  it('catalogues opus, sonnet, haiku with no key required and a chat-only preset', () => {
    expect(getProvider('claude-cli')?.requiresApiKey).toBe(false);
    for (const id of ['opus', 'sonnet', 'haiku']) {
      expect(getModelInfo('claude-cli', id)?.outputWindow).toBeGreaterThan(4096);
    }
    expect(Object.keys(getProviderPreset('claude-cli')!.capabilities)).toEqual(['chat']);
  });

  it('maps effort to the CLI provider option and never offers above high', () => {
    const { model, modelInfo } = getModel({
      providerId: 'claude-cli',
      modelId: 'opus',
      apiKey: '',
    });
    expect(modelInfo?.capabilities?.thinking?.effortValues).toEqual(['low', 'medium', 'high']);
    expect(resolveThinkingProviderOptions(model, { effort: 'medium' })).toEqual({
      'claude-cli': { effort: 'medium' },
    });
    // An effort the model does not offer is not passed through.
    expect(
      resolveThinkingProviderOptions(model, { effort: 'max' })?.['claude-cli']?.effort,
    ).not.toBe('max');
  });

  it('accepts the openmaic.yml block from the fork plan', () => {
    const config = parseModelConfig(`
providers:
  claude-cli:
    preset: claude-cli
    models: [opus, sonnet, haiku]
  anthropic:
    preset: anthropic
    apiKey: sk-test
    models: [claude-sonnet-5]
slots:
  llm: { model: "claude-cli:sonnet", thinking: { effort: medium } }
  course.outline: { model: "claude-cli:opus", thinking: { effort: medium } }
  course.agents: "claude-cli:haiku"
  classroom: "anthropic:claude-sonnet-5"
  agent: "anthropic:claude-sonnet-5"
`);
    expect(Object.keys(config.providers ?? {})).toEqual(['claude-cli', 'anthropic']);
  });
});
