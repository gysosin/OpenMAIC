import type { LanguageModel } from 'ai';

// `ai` does not export the V3 spec types; derive them from LanguageModel
// rather than depend on @ai-sdk/provider directly.
export type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: 'v3' }>;
export type CallOptions = Parameters<LanguageModelV3['doGenerate']>[0];
export type StreamPart =
  Awaited<ReturnType<LanguageModelV3['doStream']>> extends {
    stream: ReadableStream<infer P>;
  }
    ? P
    : never;
