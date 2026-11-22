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

## Measured end-to-end run (story 1.8, 2026-11-23)

Lesson "bits and bytes", 3 scenes (1 slide, 2 interactive), run `run-FTE3senRbnAU49g-`, local laptop, `PARALLEL_SCENE_CONCURRENCY=2`.

| Step | Model | Time |
|---|---|---|
| Outline | claude-cli:opus | 17 s |
| Agent profiles (4) | claude-cli:haiku | 10 s |
| Slide content | claude-cli:sonnet | 26 s |
| Slide actions (20) | claude-cli:sonnet | 9 s |
| Interactive content, scene 2 | claude-cli:opus | 3 min 39 s |
| Interactive content, scene 3 | claude-cli:opus | timed out at 300 s, retry took 4 min 44 s |
| Actions per interactive scene | claude-cli:sonnet | 7-9 s |

- Run wall time: 11.5 min, about 5 of them lost to the timeout. `sceneContent` deadline raised to 600 s (`lib/server/generation/run/deadline.ts`).
- Peak CLI children: 3 (the shared cap). None left after completion.
- Narration: 22 clips on OpenRouter, 0 unvoiced.
- Share of the weekly limit: not measured (no usage reading was available on this machine).
