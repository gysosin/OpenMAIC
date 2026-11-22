export type CliEffort = 'low' | 'medium' | 'high';

/**
 * Map an app effort to the CLI's `--effort`. The CLI also takes xhigh and max;
 * this provider never goes above high. `none` means no flag.
 */
export function clampEffort(effort: unknown): CliEffort | undefined {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high';
    default:
      return undefined;
  }
}

const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * A model id becomes a CLI argument, so it is checked against a strict pattern
 * (lowercase alphanumerics, dots and dashes, never a leading dash) and passed
 * as `--model=<id>`: it can never be read as another flag.
 */
export function assertModelId(modelId: string): void {
  if (!MODEL_ID.test(modelId))
    throw new Error(`Invalid Claude CLI model id: ${JSON.stringify(modelId)}`);
}

/**
 * argv for one call. `--safe-mode` (not `--bare`) keeps the subscription login
 * while skipping CLAUDE.md, hooks, plugins, skills, MCP and memory.
 */
export function buildCliArgs(opts: {
  modelId: string;
  systemPromptFile: string;
  effort?: CliEffort;
}): string[] {
  assertModelId(opts.modelId);
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--safe-mode',
    '--system-prompt-file',
    opts.systemPromptFile,
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-turns',
    '1',
    '--no-session-persistence',
    `--model=${opts.modelId}`,
    ...(opts.effort ? [`--effort=${opts.effort}`] : []),
  ];
}

/**
 * Child environment. Every ANTHROPIC_* variable is dropped: in `-p` mode the
 * CLI uses ANTHROPIC_API_KEY whenever it is set, which would bill the key
 * instead of the subscription login.
 */
export function buildCliEnv(
  base: Record<string, string | undefined>,
  opts: { maxOutputTokens?: number },
): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv; // Next's typings make NODE_ENV mandatory
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith('ANTHROPIC_')) env[key] = value;
  }
  if (opts.maxOutputTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(opts.maxOutputTokens);
  return env;
}
