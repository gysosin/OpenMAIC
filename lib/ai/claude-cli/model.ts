import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APICallError, UnsupportedFunctionalityError } from 'ai';
import { assertModelId, buildCliArgs, buildCliEnv, clampEffort } from './args';
import { runClaude, setClaudeCliConcurrency } from './process';
import { buildPromptPayload } from './prompt';
import { createClaudeStreamParser } from './stream';
import type { CallOptions, LanguageModelV3, StreamPart } from './types';

export const CLAUDE_CLI_PROVIDER_ID = 'claude-cli';

/** Backstop for a hung child; the caller's abortSignal is the normal way out. */
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

export interface ClaudeCliModelOptions {
  modelId: string;
  /** Defaults to `CLAUDE_CLI_PATH`, then `claude` on PATH. Spawned directly, so shell aliases never apply. */
  executablePath?: string;
  /** Process-wide cap on running CLI children (default 3). */
  maxConcurrent?: number;
}

type Warning = Extract<StreamPart, { type: 'stream-start' }>['warnings'][number];

const IGNORED_SETTINGS = [
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
] as const;

function unsupportedWarnings(options: CallOptions): Warning[] {
  const features: string[] = IGNORED_SETTINGS.filter((k) => options[k] !== undefined);
  if (options.stopSequences?.length) features.push('stopSequences');
  return features.map((feature) => ({ type: 'unsupported', feature }));
}

async function* run(
  opts: Required<Pick<ClaudeCliModelOptions, 'modelId'>> & { executablePath: string },
  options: CallOptions,
  warnings: Warning[],
): AsyncGenerator<StreamPart> {
  const { systemText, stdinPayload } = buildPromptPayload(options.prompt);
  const dir = await mkdtemp(join(tmpdir(), 'claude-cli-'));
  const cwd = join(dir, 'work'); // empty, so the CLI has nothing to read
  const systemPromptFile = join(dir, 'system.txt');
  try {
    await mkdir(cwd);
    await writeFile(systemPromptFile, systemText);
    const effort = clampEffort(options.providerOptions?.[CLAUDE_CLI_PROVIDER_ID]?.effort);
    const signals = [AbortSignal.timeout(CALL_TIMEOUT_MS)];
    if (options.abortSignal) signals.push(options.abortSignal);

    const parser = createClaudeStreamParser();
    yield { type: 'stream-start', warnings };
    try {
      for await (const line of runClaude({
        executablePath: opts.executablePath,
        args: buildCliArgs({ modelId: opts.modelId, systemPromptFile, effort }),
        env: buildCliEnv(process.env, { maxOutputTokens: options.maxOutputTokens }),
        cwd,
        stdin: stdinPayload,
        signal: AbortSignal.any(signals),
      })) {
        yield* parser.push(line);
      }
      if (!parser.finished) throw new Error('Claude CLI ended without a result');
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      yield {
        type: 'error',
        error: APICallError.isInstance(error)
          ? error
          : new APICallError({
              message: error instanceof Error ? error.message : String(error),
              url: CLAUDE_CLI_PROVIDER_ID,
              requestBodyValues: {},
              isRetryable: false,
              cause: error,
            }),
      };
      yield {
        type: 'finish',
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        finishReason: { unified: 'error', raw: undefined },
      };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createClaudeCliModel(options: ClaudeCliModelOptions): LanguageModelV3 {
  const { modelId } = options;
  assertModelId(modelId);
  const executablePath = options.executablePath ?? process.env.CLAUDE_CLI_PATH ?? 'claude';
  if (options.maxConcurrent) setClaudeCliConcurrency(options.maxConcurrent);

  const start = (call: CallOptions) => {
    // Live chat needs client-side tool calls, which the CLI cannot hand back.
    if (call.tools?.length) {
      throw new UnsupportedFunctionalityError({ functionality: 'tools (claude-cli)' });
    }
    buildPromptPayload(call.prompt); // fail on files and tool parts before anything is spawned
    return run({ modelId, executablePath }, call, unsupportedWarnings(call));
  };

  return {
    specificationVersion: 'v3',
    provider: CLAUDE_CLI_PROVIDER_ID,
    modelId,
    supportedUrls: {},

    async doStream(call) {
      const parts = start(call);
      return {
        stream: new ReadableStream<StreamPart>({
          async pull(controller) {
            const next = await parts.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          },
          async cancel() {
            await parts.return(undefined); // kills the child
          },
        }),
      };
    },

    async doGenerate(call) {
      const content: { type: 'text' | 'reasoning'; text: string }[] = [];
      let warnings: Warning[] = [];
      let usage, finishReason, response;
      for await (const part of start(call)) {
        switch (part.type) {
          case 'stream-start':
            warnings = part.warnings;
            break;
          case 'response-metadata':
            response = { id: part.id, modelId: part.modelId };
            break;
          case 'text-start':
          case 'reasoning-start':
            content.push({ type: part.type === 'text-start' ? 'text' : 'reasoning', text: '' });
            break;
          case 'text-delta':
          case 'reasoning-delta':
            content[content.length - 1]!.text += part.delta;
            break;
          case 'error':
            throw part.error;
          case 'finish':
            usage = part.usage;
            finishReason = part.finishReason;
            break;
        }
      }
      return {
        content,
        finishReason: finishReason!,
        usage: usage!,
        warnings,
        response,
      };
    },
  };
}
