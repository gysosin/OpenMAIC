import { readFileSync } from 'node:fs';
import { APICallError, UnsupportedFunctionalityError } from 'ai';
import { describe, expect, it } from 'vitest';
import { buildCliArgs, buildCliEnv, clampEffort } from '@/lib/ai/claude-cli/args';
import { buildPromptPayload } from '@/lib/ai/claude-cli/prompt';
import { createClaudeStreamParser } from '@/lib/ai/claude-cli/stream';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/claude-cli/${name}.ndjson`, import.meta.url), 'utf8')
    .trim()
    .split('\n');

describe('claude-cli args', () => {
  it('uses safe-mode, no tools, own system prompt file, never --bare', () => {
    const args = buildCliArgs({
      modelId: 'sonnet',
      systemPromptFile: '/tmp/s.txt',
      effort: 'medium',
    });
    expect(args).toContain('--safe-mode');
    expect(args).not.toContain('--bare');
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
      '--tools',
      '',
    ]);
    expect(args).toContain('--include-partial-messages');
    expect(args.slice(-2)).toEqual(['--model=sonnet', '--effort=medium']);
  });

  it('refuses a model id that could be read as a flag or a path', () => {
    for (const modelId of ['--dangerously-skip-permissions', '-x', 'a b', 'Opus', 'a/b', '']) {
      expect(() => buildCliArgs({ modelId, systemPromptFile: '/tmp/s.txt' }), modelId).toThrow(
        /Invalid Claude CLI model id/,
      );
    }
    expect(() =>
      buildCliArgs({ modelId: 'claude-opus-5-5', systemPromptFile: '/tmp/s.txt' }),
    ).not.toThrow();
  });

  it('clamps effort to high and drops none', () => {
    expect(clampEffort('max')).toBe('high');
    expect(clampEffort('xhigh')).toBe('high');
    expect(clampEffort('minimal')).toBe('low');
    expect(clampEffort('none')).toBeUndefined();
    expect(clampEffort(undefined)).toBeUndefined();
  });

  it('strips every ANTHROPIC_* variable and sets the output cap', () => {
    const env = buildCliEnv(
      { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' },
      { maxOutputTokens: 64000 },
    );
    expect(Object.keys(env).filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([]);
    expect(env).toMatchObject({ PATH: '/bin', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' });
  });
});

describe('claude-cli prompt', () => {
  it('joins system messages and sends a single user message as is', () => {
    expect(
      buildPromptPayload([
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ]),
    ).toEqual({ systemText: 'A\n\nB', stdinPayload: 'hello' });
  });

  it('flattens multi-turn history into a labelled transcript', () => {
    const { stdinPayload } = buildPromptPayload([
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
    ]);
    expect(stdinPayload).toBe('[user]\nq1\n\n[assistant]\na1\n\n[user]\nq2');
  });

  it('rejects images and tool results', () => {
    expect(() =>
      buildPromptPayload([
        {
          role: 'user',
          content: [{ type: 'file', mediaType: 'image/png', data: new Uint8Array([1]) }],
        },
      ]),
    ).toThrow(UnsupportedFunctionalityError);
    expect(() => buildPromptPayload([{ role: 'tool', content: [] }])).toThrow(
      UnsupportedFunctionalityError,
    );
  });
});

describe('claude-cli stream parser', () => {
  it('maps the recorded real stream to text parts and a finish with usage', () => {
    const parser = createClaudeStreamParser();
    const parts = fixture('hi').flatMap((line) => parser.push(line));
    const text = parts.flatMap((p) => (p.type === 'text-delta' ? [p.delta] : [])).join('');
    expect(text).toBe('Hi! How can I help you today?');
    expect(parts.map((p) => p.type)).toEqual(
      expect.arrayContaining(['response-metadata', 'text-start', 'text-end', 'finish']),
    );
    const finish = parts.at(-1)!;
    expect(finish).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: { inputTokens: { noCache: 2, cacheWrite: 577 }, outputTokens: { total: 13 } },
    });
    expect(parser.finished).toBe(true);
  });

  it('maps thinking to reasoning parts and max_tokens to length', () => {
    const parser = createClaudeStreamParser();
    const parts = fixture('thinking-truncated').flatMap((line) => parser.push(line));
    expect(parts.filter((p) => p.type === 'reasoning-delta')).toHaveLength(2);
    expect(parts.at(-1)).toMatchObject({
      finishReason: { unified: 'length' },
      usage: { outputTokens: { total: 20, reasoning: 15, text: 5 }, inputTokens: { total: 15 } },
    });
  });

  it('turns a rejected rate_limit_event into a non-retryable error naming the reset', () => {
    const parser = createClaudeStreamParser();
    const [, limit] = fixture('rate-limited');
    let error: unknown;
    try {
      parser.push(limit);
    } catch (e) {
      error = e;
    }
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ isRetryable: false, statusCode: 429 });
    expect((error as Error).message).toContain(new Date(1795870800 * 1000).toISOString());
  });

  it('keeps a warning-level rate_limit_event harmless and a 529 result retryable', () => {
    const parser = createClaudeStreamParser();
    expect(
      parser.push('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning"}}'),
    ).toEqual([]);
    expect(() =>
      parser.push('{"type":"result","is_error":true,"api_error_status":529,"result":"overloaded"}'),
    ).toThrow(expect.objectContaining({ isRetryable: true }));
  });

  it('ignores lines that are not JSON', () => {
    expect(createClaudeStreamParser().push('not json')).toEqual([]);
  });
});
