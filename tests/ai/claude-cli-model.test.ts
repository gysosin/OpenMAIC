import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APICallError, UnsupportedFunctionalityError, generateText, streamText } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeCliModel } from '@/lib/ai/claude-cli/model';

const FAKE = new URL('../fixtures/fake-claude.mjs', import.meta.url).pathname;
const fixturePath = (name: string) =>
  new URL(`../fixtures/claude-cli/${name}.ndjson`, import.meta.url).pathname;

let tmp: string;
let record: string;
const saved = { ...process.env };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fake-claude-test-'));
  record = join(tmp, 'record.json');
  process.env.FAKE_CLAUDE_RECORD = record;
  process.env.FAKE_CLAUDE_FIXTURE = fixturePath('hi');
  process.env.ANTHROPIC_API_KEY = 'sk-must-not-leak';
  process.env.ANTHROPIC_BASE_URL = 'http://must-not-leak';
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  rmSync(tmp, { recursive: true, force: true });
});

const model = (modelId = 'sonnet') => createClaudeCliModel({ modelId, executablePath: FAKE });
const recorded = () => JSON.parse(readFileSync(record, 'utf8'));

describe('claude-cli model against the fake CLI', () => {
  it('doGenerate returns text, finish reason and usage', async () => {
    const result = await generateText({ model: model(), system: 'Be brief.', prompt: 'say hi' });
    expect(result.text).toBe('Hi! How can I help you today?');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.outputTokens).toBe(13);
    expect(result.usage.inputTokens).toBe(2 + 577);
  });

  it('doStream streams the text deltas', async () => {
    const result = streamText({ model: model(), prompt: 'say hi' });
    const deltas: string[] = [];
    for await (const chunk of result.textStream) deltas.push(chunk);
    expect(deltas).toEqual(['Hi!', ' How', ' can I help you today?']);
    expect(await result.finishReason).toBe('stop');
  });

  it('passes the system prompt in a file, the prompt on stdin, effort and the output cap', async () => {
    await generateText({
      model: model('opus'),
      system: 'Be brief.',
      prompt: 'say hi',
      maxOutputTokens: 64000,
      providerOptions: { 'claude-cli': { effort: 'max' } },
    });
    const rec = recorded();
    expect(rec.stdin).toBe('say hi');
    expect(rec.systemPrompt).toBe('Be brief.');
    expect(rec.argv).toEqual(expect.arrayContaining(['--safe-mode', '--model=opus']));
    expect(rec.argv.at(-1)).toBe('--effort=high');
    expect(rec.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('64000');
    expect(rec.cwd).not.toBe(process.cwd());
  });

  it('gives the child no ANTHROPIC_* variables', async () => {
    await generateText({ model: model(), prompt: 'say hi' });
    const keys = Object.keys(recorded().env);
    expect(keys.filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([]);
    expect(keys).toContain('PATH');
  });

  it('reports max_tokens as finish reason length and surfaces reasoning', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixturePath('thinking-truncated');
    const result = await generateText({ model: model('opus'), prompt: 'x' });
    expect(result.finishReason).toBe('length');
    expect(result.text).toBe('Cut o');
    expect(result.reasoningText).toBe('Plan: answer briefly.');
  });

  it('throws on a rejected rate limit, non-retryable, with the reset time', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixturePath('rate-limited');
    const error = await generateText({ model: model(), prompt: 'x', maxRetries: 2 }).catch(
      (e) => e,
    );
    const cause = APICallError.isInstance(error) ? error : error.lastError;
    expect(cause.isRetryable).toBe(false);
    expect(cause.message).toContain('resets at 2026-');
  });

  it('throws when the call has tools', async () => {
    await expect(
      model().doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [{ type: 'function', name: 't', inputSchema: { type: 'object' } }],
      }),
    ).rejects.toThrow(UnsupportedFunctionalityError);
    await expect(
      model().doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [{ type: 'function', name: 't', inputSchema: { type: 'object' } }],
      }),
    ).rejects.toThrow(UnsupportedFunctionalityError);
  });

  it('turns a crashing child into a generic error; stderr stays out of the message', async () => {
    process.env.FAKE_CLAUDE_MODE = 'crash';
    const error = await generateText({ model: model(), prompt: 'x', maxRetries: 0 }).catch(
      (e) => e,
    );
    expect(error.message).toBe('Claude CLI failed (exit 3)');
    expect(JSON.stringify(error.message)).not.toContain('boom');
    expect(String(error.cause?.cause)).toContain('boom');
  });

  it('reports a missing binary without naming its path', async () => {
    const missing = createClaudeCliModel({ modelId: 'haiku', executablePath: join(tmp, 'nope') });
    const error = await generateText({ model: missing, prompt: 'x', maxRetries: 0 }).catch(
      (e) => e,
    );
    expect(error.message).toBe('Could not start Claude CLI');
    expect(error.message).not.toContain(tmp);
  });

  it('throws before spawning for a model id that looks like a flag', async () => {
    expect(() =>
      createClaudeCliModel({ modelId: '--dangerously-skip-permissions', executablePath: FAKE }),
    ).toThrow(/Invalid Claude CLI model id/);
    expect(existsSync(record)).toBe(false);
  });

  for (const mode of ['hang', 'stubborn']) {
    it(`abort stops a ${mode} child within 2 s`, async () => {
      process.env.FAKE_CLAUDE_MODE = mode;
      const controller = new AbortController();
      const started = Date.now();
      const call = generateText({
        model: model(),
        prompt: 'x',
        abortSignal: controller.signal,
        maxRetries: 0,
      });
      call.catch(() => {});
      await new Promise((r) => setTimeout(r, 400)); // let the child start
      controller.abort();
      await expect(call).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2400);
    });
  }
});
