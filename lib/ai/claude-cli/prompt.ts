import { UnsupportedFunctionalityError } from 'ai';
import type { CallOptions } from './types';

type Prompt = CallOptions['prompt'];

const DEFAULT_SYSTEM = 'You are a helpful assistant.';

/**
 * Flatten an AI SDK prompt into what the CLI takes: one system prompt and one
 * user message on stdin. The CLI cannot receive an assistant history, so a
 * multi-turn prompt becomes a labelled transcript inside that one message.
 * Images and tool parts have no CLI path and throw.
 */
export function buildPromptPayload(prompt: Prompt): { systemText: string; stdinPayload: string } {
  const system: string[] = [];
  const turns: { role: 'user' | 'assistant'; text: string }[] = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      throw new UnsupportedFunctionalityError({ functionality: 'tool results' });
    }
    const text: string[] = [];
    for (const part of message.content) {
      if (part.type === 'text') text.push(part.text);
      else if (part.type === 'reasoning') continue;
      else if (part.type === 'file') {
        throw new UnsupportedFunctionalityError({ functionality: 'file or image input' });
      } else throw new UnsupportedFunctionalityError({ functionality: 'tool calls' });
    }
    turns.push({ role: message.role, text: text.join('\n') });
  }

  const stdinPayload =
    turns.length === 1 && turns[0].role === 'user'
      ? turns[0].text
      : turns.map((t) => `[${t.role}]\n${t.text}`).join('\n\n');

  return { systemText: system.join('\n\n') || DEFAULT_SYSTEM, stdinPayload };
}
