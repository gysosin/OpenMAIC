# claude-cli provider

Runs the local Claude Code CLI as an AI SDK language model (`lib/ai/claude-cli/`), so generation uses the owner's Claude subscription instead of an API key. Personal use only; see section B6 of `PLAN.md`.

## What it does

Each call spawns `claude -p` with stream-json output and no tools, and feeds the prompt on stdin. Flags:

```
-p --output-format stream-json --verbose --include-partial-messages --safe-mode
--system-prompt-file <tmp> --tools "" --strict-mcp-config --disable-slash-commands
--max-turns 1 --no-session-persistence --model <opus|sonnet|haiku|fable> [--effort low|medium|high]
```

- Every `ANTHROPIC_*` variable is removed from the child environment, so the subscription login is used.
- `maxOutputTokens` becomes `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. Effort is clamped to `high`.
- At most 3 children run at once (shared across all calls in the process).
- Abort sends SIGINT to the child, SIGTERM after 0.5 s, SIGKILL after 1.2 s.
- A rejected plan limit becomes a non-retryable error that names the reset time.
- Calls with tools, images or tool results throw. Keep `classroom` and `agent` slots on an API-key provider.
- The binary is `CLAUDE_CLI_PATH`, else `claude` on `PATH`. It is spawned directly, so shell aliases do not apply.

## openmaic.yml example

```yaml
providers:
  claude-cli:
    preset: claude-cli
    models: [opus, sonnet, haiku]
  anthropic: # live chat and quiz grading need tool calling
    preset: anthropic
    apiKey: ${ANTHROPIC_API_KEY}
    models: [claude-sonnet-5]
slots:
  llm: { model: 'claude-cli:sonnet', thinking: { effort: medium } }
  course.outline: { model: 'claude-cli:opus', thinking: { effort: medium } }
  course.content.interactive: { model: 'claude-cli:opus', thinking: { effort: medium } }
  course.agents: 'claude-cli:haiku'
  classroom: 'anthropic:claude-sonnet-5'
  agent: 'anthropic:claude-sonnet-5'
```

Set `PARALLEL_SCENE_CONCURRENCY=2` in `.env.local`.
