import { APICallError } from 'ai';
import type { StreamPart } from './types';

type Usage = Extract<StreamPart, { type: 'finish' }>['usage'];
type FinishReason = Extract<StreamPart, { type: 'finish' }>['finishReason'];

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function finishReason(raw: string | undefined): FinishReason {
  const unified =
    raw === 'end_turn' || raw === 'stop_sequence'
      ? 'stop'
      : raw === 'max_tokens'
        ? 'length'
        : raw === 'tool_use'
          ? 'tool-calls'
          : raw === 'refusal'
            ? 'content-filter'
            : 'other';
  return { unified, raw };
}

function usageFrom(u: Json | undefined): Usage {
  const input = u?.input_tokens as number | undefined;
  const read = (u?.cache_read_input_tokens as number | undefined) ?? 0;
  const write = (u?.cache_creation_input_tokens as number | undefined) ?? 0;
  const out = u?.output_tokens as number | undefined;
  const reasoning = (u?.output_tokens_details?.thinking_tokens as number | undefined) ?? 0;
  return {
    inputTokens: {
      total: input === undefined ? undefined : input + read + write,
      noCache: input,
      cacheRead: read,
      cacheWrite: write,
    },
    outputTokens: {
      total: out,
      text: out === undefined ? undefined : out - reasoning,
      reasoning,
    },
    raw: u,
  };
}

function apiError(message: string, statusCode: number | undefined, retryable: boolean) {
  return new APICallError({
    message,
    url: 'claude-cli',
    requestBodyValues: {},
    statusCode,
    isRetryable: retryable,
  });
}

/**
 * Turns the CLI's stream-json lines into AI SDK stream parts. Stateful (it
 * tracks open blocks), one instance per call. `push` throws the call's error:
 * a rejected plan limit (never retryable, names the reset time) or an errored
 * `result`.
 */
export function createClaudeStreamParser() {
  const open = new Map<number, 'text' | 'reasoning'>();
  let rawStop: string | undefined;
  let finished = false;

  return {
    get finished() {
      return finished;
    },
    push(line: string): StreamPart[] {
      let msg: Json;
      try {
        msg = JSON.parse(line);
      } catch {
        return [];
      }

      if (msg.type === 'rate_limit_event') {
        const info = msg.rate_limit_info as Json | undefined;
        if (info?.status === 'rejected') {
          const reset =
            typeof info.resetsAt === 'number'
              ? new Date(info.resetsAt * 1000).toISOString()
              : 'an unknown time';
          throw apiError(
            `Claude plan limit reached (${info.rateLimitType ?? 'unknown window'}); resets at ${reset}`,
            429,
            false,
          );
        }
        return [];
      }

      if (msg.type === 'result') {
        finished = true;
        if (msg.is_error) {
          const status = (msg.api_error_status as number | null) ?? undefined;
          throw apiError(
            `Claude CLI error (${msg.subtype ?? 'unknown'}): ${msg.result ?? ''}`.trim(),
            status,
            status !== undefined && RETRYABLE.has(status),
          );
        }
        return [
          {
            type: 'finish',
            usage: usageFrom(msg.usage),
            finishReason: finishReason(msg.stop_reason ?? rawStop),
          },
        ];
      }

      if (msg.type !== 'stream_event') return [];
      const ev = msg.event as Json;
      const index = ev.index as number;

      switch (ev.type) {
        case 'message_start':
          return [{ type: 'response-metadata', id: ev.message?.id, modelId: ev.message?.model }];
        case 'content_block_start': {
          const kind = ev.content_block?.type;
          if (kind === 'text') {
            open.set(index, 'text');
            return [{ type: 'text-start', id: String(index) }];
          }
          if (kind === 'thinking') {
            open.set(index, 'reasoning');
            return [{ type: 'reasoning-start', id: String(index) }];
          }
          return [];
        }
        case 'content_block_delta': {
          const d = ev.delta as Json;
          if (d.type === 'text_delta' && open.get(index) === 'text')
            return [{ type: 'text-delta', id: String(index), delta: d.text }];
          if (d.type === 'thinking_delta' && open.get(index) === 'reasoning')
            return [{ type: 'reasoning-delta', id: String(index), delta: d.thinking }];
          return [];
        }
        case 'content_block_stop': {
          const kind = open.get(index);
          open.delete(index);
          if (kind === 'text') return [{ type: 'text-end', id: String(index) }];
          if (kind === 'reasoning') return [{ type: 'reasoning-end', id: String(index) }];
          return [];
        }
        case 'message_delta':
          rawStop = ev.delta?.stop_reason ?? rawStop;
          return [];
        default:
          return [];
      }
    },
  };
}
