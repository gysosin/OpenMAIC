# Fork plan: classroom fixes, Claude Code provider, 3D/step demos, UI redesign

Date: 2026-11-22. Base: `main` at `3a13811f` (v1.5.0-rc.3). Fork-only document; nothing here is meant for upstream.

Scope: a single-user, local install used to learn CS from first principles (binary to ML/LLMs, 20 modules). Everything below is planning. No code has been changed.

How to read the evidence labels:

- **Verified** = read in the code, queried from the local database, or run on this machine.
- **Estimate** = my judgement, not measured.

---

## 0. Summary

| # | Ask | Answer |
|---|-----|--------|
| 1 | Slide cut off, transcript overlaps in fullscreen | Four separate causes, all found in code (section A). Five small stories fix them. |
| 2 | Ask about anything easily | The pick-an-element-then-ask flow already exists but is three steps behind a toolbar toggle. Make it one gesture (section C4). |
| 3 | 3D and animated step demos in every lesson | The iframe sandbox, three.js, widget actions synced to narration, and a step-reveal diagram already exist. What is missing is reliability and a guarantee. Add a declarative demo spec rendered by one vetted runtime, and a hard check in the outline step (section C). |
| 4 | Generation through the Claude Code subscription | A separate `claude-cli` provider module that spawns `claude -p --safe-mode`. Verified working on this machine with the subscription login. Generation slots move to it; live classroom chat stays on the API key because it needs tool calling (section B). |

Phases (section E): **1** bugs + provider, **2** classroom UI, **3** demo kit, **4** click-to-ask, **5** optional extras.

---

## A. Bugs: root cause from code

### A1. Slide is smaller than its card (double letterbox)

**Verified.** The slide is drawn at 90% of the stage card, inside a card that is already letterboxed.

- `lib/store/canvas.ts:229` sets `canvasPercentage: 90`.
- Both playback renderers apply it: `components/slide-renderer/Editor/Canvas/hooks/useViewportSize.ts:41,48` (legacy `ScreenCanvas`) and `components/slide-renderer/Editor/RendererScreenCanvas.tsx:306,362` (new renderer).
- The workbench pane already overrides it to 100 and its comment names this exact gap: `lib/workbench/use-workbench-pro-edit.ts:1-24`.
- Measured on the owner's screenshot: stage card 971 x 546 px, slide 873 x 492 px. The slide uses 81% of the card's area, and the card uses about 37% of the 1485 x 928 px available to the left of the notes panel.

**Minimal fix.** Reuse the existing hook. Rename `useWorkbenchProEditing` to something neutral (for example `useFullBleedCanvas`) and call it from `PlaybackChromeRoot` as well. The 90% margin stays only for the full-page editor.

### A2. Stage box is not always 16:9, and fixed chrome takes the height

**Verified.**

- `components/canvas/canvas-area.tsx:337-345`: on the classroom page the stage box is `aspect-[16/9] h-full max-h-full max-w-full`. When the area is narrower than 16:9 (chat panel open at up to 560 px, sidebar open, or a small window), `max-w-full` clamps the width while `h-full` keeps the height, so the box stops being 16:9. The slide inside still fits, but the scene-number badge, whiteboard layer and element-pick overlay are positioned against the box, not the slide.
- The workbench path at `canvas-area.tsx:347-352` uses `ContainBox fit="contain"` (`components/edit/ContainBox.tsx`), which computes the largest true 16:9 box.
- Height budget at a 928 px viewport: header about 90 px, dock 192 px by default (`lib/edit/dock-height.ts:2`, `DOCK_DEFAULT_HEIGHT`). The stage gets about 546 px.

**Minimal fix.** Delete the `!workbench` branch and use `ContainBox` for both. Height is recovered in the redesign (section D): slimmer header, dock folded by default, focus mode.

### A3. Slide content really is clipped (generation produces overflowing text)

**Verified on the course in the screenshot** (`stage-fs0_tygHfAAs`, scene 1, canvas 1000 x 562.5):

| Element | top | height | bottom | Note |
|---|---|---|---|---|
| `shape_JTiPSSf5` (red box) | 492 | 60 | 552 | Prompt rule is bottom <= canvas height - 50 = 512 |
| `text_yqRfNzkb` ("Watch out: ...") | 499 | 46 | 545 | 46 is the one-line value from the lookup table; the text wraps to two lines at width 840 |

- The slide wrapper clips: `components/slide-renderer/Editor/ScreenCanvas.tsx:66` (`overflow-hidden`).
- Text height comes only from a table the model is asked to follow: `packages/@openmaic/generation/templates/slide-content/system.md:452-494` ("Text Height Lookup Table"), bottom margin rule at line 32. Nothing measures or corrects the result afterwards. The legacy text element renders a fixed-height outer box with an auto-height inner box (`components/slide-renderer/components/element/TextElement/BaseTextElement.tsx:31,46`), so extra lines spill out and get cut by the slide edge.

**Minimal fix, two layers.**

1. **Render-time fit guard (fixes existing courses too).** In the playback canvas, after layout, measure the lowest rendered element bottom (DOM boxes, so wrapped text counts). If it passes the slide height, scale the element layer down uniformly (origin top centre, floor about 0.8). Applies to both `ScreenCanvas` and `RendererScreenCanvas`.
2. **Generation layout guard (new courses).** In `packages/@openmaic/generation/src/scene-generator.ts`, next to the existing element normalisation (around lines 540-570): estimate wrapped line count per text element from its width and font size, raise `height` to the table value for that line count, shift the elements below it, and if the result still passes canvas height minus margin, compress vertical gaps. Pure function with unit tests.

### A4. Interactive pages can scroll below the fold

**Verified, by design.** The frame shrinks a tall page only to 75% of fit scale and then scrolls with a "more below" cue: `lib/interactive/logical-viewport.ts:16` (`GENUI_FIT_MIN_SCALE_RATIO = 0.75`), `components/scene-renderers/InteractiveMoreBelowCue.tsx`. A1/A2 give these pages more room. Demo-kit pages (section C) are laid out to exactly fill the frame, so they never scroll.

### A5. Transcript bubble overlaps the slide in fullscreen and cannot be moved

**Verified.**

- `components/edit/PlaybackChromeRoot.tsx:1993-2000`: when `isPresenting`, the Roundtable wrapper becomes `absolute inset-x-0 bottom-0 z-20` and the canvas takes the full height. On a 16:9 screen the slide then fills the screen exactly, so there is no free space and any overlay covers content.
- `components/roundtable/index.tsx:1312`: in presenting mode Roundtable returns only `speechLayer` (built at lines 841-861).
- `components/roundtable/presentation-speech-overlay.tsx:472`: the bubble is `absolute bottom-6 left-6 z-30`, width `min(420px, ...)` (line 14), text area up to 140 px tall (line 276).
- It can collapse to a pill, but that state is a local `useState` (about line 415), so it resets on every mount. There is no drag, no dock position, no persisted choice.
- The same overlay is used outside fullscreen whenever the dock is folded (`overStage`, `components/roundtable/index.tsx:231`), so folding the dock to get a bigger slide brings the overlap back.

**Minimal fix.** One persisted setting, `captionMode`, with four values:

| Mode | Behaviour |
|---|---|
| `band` (new default in fullscreen and with a folded dock) | A subtitle strip below the slide. The canvas container reserves its height, so the slide re-fits above it and nothing overlaps. |
| `float` | Today's bubble, now draggable (`motion` is already a dependency; its `drag` prop with the stage as constraint) with position remembered. |
| `pill` | Collapsed speaker pill, remembered. |
| `off` | Hidden; the Notes panel still has the full transcript. |

State lives in `lib/store/settings.ts` beside `dockHeight` / `dockCollapsed` (fields at lines 143-149, persisted key list at 209-214). Shortcut `T` cycles modes.

---

## B. Claude Code subscription provider

### B1. What the app's provider layer looks like (verified)

- AI SDK `ai` 6.x, provider spec `LanguageModelV3`.
- `lib/types/provider.ts:39`: `ProviderType = 'openai' | 'azure' | 'anthropic' | 'bedrock' | 'google'`.
- `lib/ai/providers.ts:2341` `getModel(config)`; switch on provider type at line 2422; Anthropic case at 2646; unknown types throw at 2745. Every existing provider is HTTP. There is no subprocess-backed model yet.
- All calls go through `lib/ai/llm.ts`: `callLLM` (line 347, `generateText`) and `streamLLM` (line 850, `streamText`). `lib/server/generation/ai-call.ts:9` passes `maxOutputTokens: modelInfo?.outputWindow`.
- Generation uses **plain text plus JSON repair** (`packages/@openmaic/generation/src/json-repair.ts`). No `generateObject`, no tool calling in generation steps.
- Vision is optional: `lib/server/generation/vision-images.ts:24` is called from the outline, scene-content and scene-actions steps only when the model declares `capabilities.vision`.
- **Live classroom chat uses tool calling.** `app/api/chat/pi/route.ts` drives `lib/chat/pi/director-loop.ts` (tools at line 146) through `lib/agent/runtime/stream-fn.ts:457` (`tools: toAiTools(...)`). Its stage `chat-adapter` resolves to the `classroom` slot (`lib/config/model-slots.ts:96-116`). The `agent` slot declares `requires: ['toolCalling']`.
- Config: `openmaic.yml` (`lib/server/model-config/openmaic-yml.ts`), providers by `preset`, per-slot `provider:model`.
- Scene concurrency: `PARALLEL_SCENE_CONCURRENCY` env, default 0 (serial), max 10 (`lib/server/provider-config.ts:1119`).

### B2. CLI behaviour (checked against current docs and run locally)

Verified with one tiny call on this machine (CLI 2.1.330, Haiku, `--safe-mode`):

- Auth came from the subscription login (`apiKeySource: "none"`), no tools, no MCP servers, whole system prompt about 650 tokens.
- 615 ms from process start to request, 1.46 s total.
- Stream lines seen, in order: `system/init`, `system/status`, `stream_event` (`message_start`, `content_block_start`, `content_block_delta` with `text_delta`, `content_block_stop`, `message_delta` with `stop_reason`, `message_stop`), `assistant`, `rate_limit_event`, `result`.
- `result` carries `is_error`, `subtype`, `result`, `stop_reason`, `usage`, `api_error_status`, and per-model `maxOutputTokens` (128000 for `claude-haiku-5-5`).
- `rate_limit_event` carries `status`, `rateLimitType` (saw `seven_day`), `resetsAt`, and `overageStatus: "rejected"`. On this account, hitting the limit fails the call instead of billing extra.

Flags to use:

| Need | Flag / env | Note |
|---|---|---|
| Non-interactive | `-p` | Prompt on stdin (cap 10 MB) |
| Token streaming | `--output-format stream-json --verbose --include-partial-messages` | All three are required together |
| Keep subscription login, drop every customisation | `--safe-mode` | Skips CLAUDE.md, hooks, plugins, skills, MCP, memory. **Do not use `--bare`**: docs say bare mode never reads OAuth credentials and needs an API key. |
| Own system prompt | `--system-prompt-file <tmp>` | Replaces the coding-agent prompt. Generation prompts are up to 30 KB, so use a file, not an argument. |
| No tools | `--tools "" --strict-mcp-config --disable-slash-commands` | Verified: 0 tools, 0 MCP |
| One model turn | `--max-turns 1` | |
| No transcript on disk | `--no-session-persistence` | Otherwise each call adds a session file |
| Model | `--model opus\|sonnet\|haiku\|fable` or a full id | Aliases resolve to the newest model (`haiku` gave `claude-haiku-5-5`), so no catalogue chasing |
| Thinking | `--effort low\|medium\|high` | CLI also accepts `xhigh` and `max`; clamp to `high` |
| Output cap | env `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Docs: values above the model cap are lowered to it; unknown model ids default to 32000 |
| Images | `--input-format stream-json` with an `image` content block (base64) | Documented for streaming input; not yet tried here |

Two traps:

1. **`ANTHROPIC_API_KEY` must be removed from the child's environment.** `.env.local` defines it, so the Next.js process has it. Docs: in `-p` mode "the key is always used when present", which would bill the API key and silently defeat the point. Also remove `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`.
2. **Spawn the binary by path.** In the owner's shell `claude` is an alias that adds permission-skipping flags; `spawn` does not use aliases, and should not. Default to `claude` on `PATH`, overridable with `CLAUDE_CLI_PATH` (here `/home/xyfo/.local/bin/claude`). Run with `cwd` set to an empty temp directory.

### B3. Design

A separate module, as AGENTS.md's provider-neutrality rule requires. No new dependency.

```
lib/ai/claude-cli/
  model.ts        createClaudeCliModel({ modelId, executablePath?, maxConcurrent? }): LanguageModelV3
  args.ts         pure: build argv + env from call options        (unit-tested)
  prompt.ts       pure: LanguageModelV3Prompt -> { systemText, stdinPayload }
  stream.ts       pure: NDJSON line -> LanguageModelV3StreamPart[] (unit-tested with recorded lines)
  process.ts      spawn, stdin write, line splitter, abort, timeout, semaphore
```

Mapping:

| AI SDK | CLI |
|---|---|
| `system` messages | joined into the system prompt file |
| single user message | stdin text |
| multi-turn history | flattened into one labelled transcript in a single user message (the CLI's input stream takes user messages only) |
| `maxOutputTokens` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| `providerOptions['claude-cli'].effort` | `--effort` |
| `abortSignal` | SIGINT to the child's own PID, then SIGTERM after a grace period. Never signal anything but the PID returned by `spawn`. |
| `text_delta` / `thinking_delta` | `text-delta` / `reasoning-delta` parts |
| `message_delta.stop_reason` | `finishReason` (`max_tokens` -> `length`) |
| `result.usage` | `usage` |
| `result.is_error`, non-zero exit, `rate_limit_event.status != "allowed"` | `APICallError`; retryable for 429/529, not retryable for an exhausted plan limit, with `resetsAt` in the message |
| `tools` in the call | Not supported. Throw `UnsupportedFunctionalityError` so a misrouted slot fails loudly. |
| image parts | Phase 5. Until then declare `capabilities.vision: false`; generation already skips images for such models. |

Registration (small edits in shared files):

- `lib/types/provider.ts`: add `'claude-cli'` to `ProviderType` and a built-in provider id.
- `lib/ai/providers.ts`: one `PROVIDERS` entry (`requiresApiKey: false`, same pattern as the local-server providers; models `opus`, `sonnet`, `haiku`, `fable` with `outputWindow` set and `capabilities { streaming: true, tools: false, vision: false, thinking: true }`), and one `case 'claude-cli'` in `getModel` that calls `createClaudeCliModel`.
- `lib/config/provider-presets.ts`: a `claude-cli` preset offering only the `chat` capability.
- `lib/ai/thinking-config.ts`: map the app's effort to `{ 'claude-cli': { effort } }`.
- Check and extend `tests/providers/provider-neutrality-guard.test.ts` and `tests/lint-llm-entry-guard.test.ts` rather than exempting anything.

Target `openmaic.yml` (keys unchanged, TTS untouched):

```yaml
providers:
  claude-cli:
    preset: claude-cli
    models: [opus, sonnet, haiku]
  anthropic:            # kept only for the slots that need tool calling
    preset: anthropic
    apiKey: ...
    models: [claude-sonnet-5]
  openrouter-tts: ...   # as today
slots:
  llm:                        { model: claude-cli:sonnet, thinking: { effort: medium } }
  course.outline:             { model: claude-cli:opus,   thinking: { effort: medium } }
  course.content.interactive: { model: claude-cli:opus,   thinking: { effort: medium } }
  course.agents:              claude-cli:haiku
  classroom:                  anthropic:claude-sonnet-5   # live chat, quiz grading: tool calling
  agent:                      anthropic:claude-sonnet-5
  tts:                        openrouter-tts:fish-audio/drama-3
```

### B4. What does not work through the CLI

| Feature | Why | Decision |
|---|---|---|
| Live classroom chat, `agent` slot | Needs client-side tool calls; the CLI only runs its own tools | Stay on the API key. Chat turns are small next to generation. Emulation is story 5.1 if wanted. |
| Vision input (PDF page images, slide images) | Needs stream-json input with image blocks | Off at first. A text-prompt CS course does not need it. Story 5.2. |
| Schema-enforced JSON | `--json-schema` exists but returns only at the end | Not needed; the app repairs JSON itself. |
| `temperature`, `topP`, stop sequences | No CLI flags | Ignored with a warning. The app sets no temperature today. |

### B5. Rate limits, latency, concurrency

- Every call is a new process. Startup cost measured at about 0.6 s. Memory per process is an **estimate** of 150-300 MB; measure in story 1.8 before raising concurrency. The laptop is shared with other sessions.
- Plan usage is shared with the owner's normal Claude Code work, on the five-hour and seven-day windows. A 29-scene lesson is roughly 60-70 calls (outline, agent profiles, content and actions per scene). **Estimate.**
- **Recommendation:** `PARALLEL_SCENE_CONCURRENCY=2`, and a semaphore of 3 inside the provider so outline, agents and scenes cannot stack up. Raise to 3 scene workers only after measuring.
- Model split to protect the weekly limit: Opus for outline and demo specs (few calls, judgement-heavy), Sonnet for slides and actions (most calls), Haiku for agent profiles.
- Demo specs are small JSON, so a 3D scene costs far fewer output tokens than today's hand-written three.js page (the current template alone is 18 KB of prompt). **Estimate:** 5-10x fewer output tokens per 3D scene.
- When the plan limit is reached the provider raises a non-retryable error naming the reset time. The generation run already supports stop and retry per scene, so the lesson resumes after the reset.

### B6. Terms of use (short and honest)

Anthropic's Agent SDK page says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." The help-centre article on using the SDK with a plan (notes dated June 15 and October 7, 2026) says that when signed in with a plan, the Agent SDK and `claude -p` "still draw from your subscription limits". So running `claude -p` on your own machine with your own login is a documented use; offering that login to anyone else is not allowed. Keep this provider strictly personal: do not deploy the fork for others with it enabled, do not share the instance, and do not send it upstream as a default. Terms change; this is a reading of the public pages, not legal advice.

---

## C. Interactive, 3D and motion lessons

### C1. What the best products do, turned into rules

| Source | What makes it work | Rule for this fork |
|---|---|---|
| Brilliant | An interaction every 30-60 seconds; predict, then reveal; one idea per screen | Every demo has at least one **checkpoint** step where playback pauses and the learner answers inside the demo |
| 3Blue1Brown / Manim | Objects transform instead of cutting; the picture moves at the pace of the voice | One persistent stage per demo; each step is a tween from the previous state, started by the narration |
| Bartosz Ciechanowski | One model that gains parts as the text goes on; a slider scrubs time; drag to rotate | A scrubber over the steps; orbit controls always on; later steps add to the same scene |
| Distill.pub | Prose and figure are linked: hover a term, the figure highlights | Notes lines and demo objects share ids; hovering one highlights the other |
| Seeing Theory, Setosa | A few sliders, live result, almost no chrome | At most three controls per demo; readouts update live |
| Nicky Case | Play first, explain after | Demos open in a state the learner can already poke |
| Khan Academy | Short mastery checks between explanations | Keep the existing quiz scenes; add a quiz after each demo-heavy block |

### C2. What already exists (reuse first)

**Verified in code.**

- Sandboxed iframe host with a keep-alive pool: `components/scene-renderers/InteractiveIframeHost.tsx` (`sandbox="allow-scripts allow-forms allow-popups"`, line 495).
- Vendored libraries served from `/vendor/interactive`: three 0.160.0, KaTeX 0.16.38, Chart.js 4.4.8, Tailwind browser build (`packages/@openmaic/generation/src/interactive-libraries.ts`).
- Widget types `simulation`, `diagram`, `code`, `game`, `visualization3d`, `procedural-skill`, each with its own prompt template under `packages/@openmaic/generation/templates/`.
- Narration-synced widget actions: `widget_highlight`, `widget_setState`, `widget_annotation`, `widget_reveal`, sent as `HIGHLIGHT_ELEMENT`, `SET_WIDGET_STATE`, `ANNOTATE_ELEMENT`, `REVEAL_ELEMENT` (`lib/action/engine.ts:870-912`, played by `lib/playback/engine.ts:735-749`).
- A step-reveal diagram protocol: `revealOrder` plus `REVEAL_ELEMENT` on `#node-{id}` (`templates/diagram-content/system.md`).
- Fit-to-frame measurement (`lib/interactive/content-fit-shim.ts`), a state bridge so chat can read what the widget shows (`lib/interactive/observation*.ts`), and an element picker inside iframes (`element-picker:arm` in `InteractiveIframeHost.tsx`).
- `gsap` 3.15 (dev dependency), `motion` 12, `@xyflow/react`, `echarts`, `react-resizable-panels` 4.12 are installed.

**Gaps.**

1. 3D pages are free-form three.js written by the model from an 18 KB template. That is the unreliable part: black scenes, syntax errors, missing listeners.
2. A likely real defect: the 3D template's listener reads `event.data.action` and `payload` (`templates/visualization3d-content/system.md:622-650`), while the platform and the diagram template use `event.data.type`, `target`, `state`. Narration-driven actions probably do nothing on generated 3D pages. Confirm in story 3.1; the kit makes it moot.
3. The outline prompt caps interactivity: "Limit to 1-2 interactive scenes per course" (`templates/requirements-to-outlines/system.md:148`, repeated at 383).
4. Widget actions wait a fixed delay; there is no named step, no scrubber, no checkpoint.

### C3. Design: a demo spec rendered by one vetted runtime

**Decision: no new scene type.** A demo is still an `interactive` scene whose stored content is HTML. That HTML is a fixed shell: one JSON block (the spec) and one script tag (the kit). So there is no change to the DSL package, the storage schema, the editor, thumbnails or export, and everything in C2 keeps working.

```
model writes  -> DemoSpec (JSON, validated with zod, repaired or retried on failure)
server wraps  -> <html> shell + <script type="application/json" id="demo-spec"> + kit <script>
iframe runs   -> demo-kit.js reads the spec, builds the stage, listens for platform messages
```

**Runtime (`lib/demo-kit/`, bundled by esbuild into `public/vendor/interactive/demo-kit@<version>/`, same approach as `scripts/build-standalone-player.mjs`).**

| Part | Library | Why |
|---|---|---|
| 3D stage, orbit controls, labels, picking | three (already vendored) | Plain three, no React inside the sandbox |
| Step timeline, scrubbing | gsap timeline with one label per step | `tweenTo(label)` gives forward, back and scrub for free |
| 2D / 2.5D flow diagrams | SVG drawn by the kit, small layered layout written in the kit | Mermaid gives a static picture with no per-step control; add `elkjs` only if the simple layout proves too weak |
| Math labels | KaTeX (already vendored) | |
| Formulas in plots and sliders | a small whitelist expression parser | No `eval` or `new Function`, even inside the sandbox |

Considered and not used in the kit: react-three-fiber and drei (they need React and a bundler inside a `srcdoc` page, for no gain here), D3 (bring in `d3-scale` / `d3-shape` only when a plot preset needs them), Mermaid (see above). `motion` stays the animation library for the classroom chrome.

**Spec shape (version 1).**

```jsonc
{
  "version": 1,
  "kind": "scene3d",                    // scene3d | flow | preset
  "preset": "logic-circuit",            // only when kind = preset
  "params": { "circuit": "half-adder" },
  "title": "Half adder",
  "objects": [                          // scene3d: primitives only
    { "id": "a",   "type": "box",   "at": [-2, 0, 0], "label": "A", "ask": "Input bit A" },
    { "id": "xor", "type": "gate",  "gate": "xor", "at": [0, 0.6, 0] },
    { "id": "w1",  "type": "wire",  "from": "a", "to": "xor" }
  ],
  "steps": [
    { "id": "s1", "caption": "Both inputs are 0", "set": { "a.value": 0, "b.value": 0 } },
    { "id": "s2", "caption": "Flip A to 1",       "set": { "a.value": 1 }, "pulse": ["w1"], "camera": "xor" },
    { "id": "s3", "checkpoint": { "question": "What is the carry bit now?", "options": ["0", "1"], "answer": 0 } }
  ],
  "controls": [ { "id": "aToggle", "type": "toggle", "bind": "a.value" } ]
}
```

- Primitive types: `box`, `sphere`, `cylinder`, `plane`, `arrow`, `wire`, `label`, `grid`, `group`, `cell`, `gate`, `surface`.
- Step verbs: `set`, `show`, `hide`, `move`, `pulse`, `highlight`, `camera`, `caption`, `checkpoint`.
- Every object may carry `ask` (a one-line description used by click-to-ask, section C5).
- Unknown fields are dropped by the validator; an invalid spec is retried once, then replaced by a preset with default parameters, so a lesson never ships a broken demo.

**Presets** are functions that expand a few parameters into primitives and steps, so the model can ask for a whole demo in ten lines. Ordered by the owner's curriculum:

| Batch | Presets | Modules served |
|---|---|---|
| 1 | `bit-register` (binary counting, two's complement, bytes), `logic-circuit` (gates, half/full adder), `memory-grid` (cells, addresses, pointers, stack frames), `data-structure` (array, linked list, tree, hash table operations) | binary, logic, memory, data structures |
| 2 | `cpu-datapath` (fetch, decode, execute), `flow` (pipelines, state machines, protocols with tokens moving on edges), `packet-layers`, `algo-trace` (sort/search with code line highlight) | architecture, OS, networks, algorithms |
| 3 | `surface-plot` (loss surface, gradient descent ball), `tensor` (matrix multiply, convolution), `neural-net` (layers, forward and backward pass), `embedding-space`, `attention` (tokens, attention arcs) | linear algebra, ML, LLMs |

**Routing without touching upstream templates.** Add new template folders (`demo3d-content`, `demoflow-content`) and switch `visualization3d` and `diagram` scenes to them behind one env flag (`OPENMAIC_DEMO_KIT=1`). The free-form `simulation` type stays as the escape hatch. Upstream's template files are left alone, which keeps merges clean.

**Known limits.** The exported standalone HTML will reference the kit by URL, so offline export of demo scenes needs the kit inlined (not planned). The iframe pool keeps several pages alive; the kit must stop its render loop when its frame is hidden and release its WebGL context when evicted, or the browser's context cap will be hit after a dozen demo scenes.

### C4. Guaranteeing demos in every lesson

Two layers, because a prompt alone is not a guarantee.

1. **Prompt.** A fork snippet replaces the "1-2 interactive scenes" limit with: at least one `visualization3d` demo per lesson; one demo (3D or flow) for every concept that has state changing over time or spatial structure; target about one demo per three or four slides; a quiz after each demo-heavy block.
2. **Deterministic check** in the outline step (`lib/server/generation/steps/outline.ts`), after parsing: if the outline has no `visualization3d` scene, make one repair call; if that fails, insert a demo scene after the first concept slide using the preset that matches the lesson's module. If a concept slide's key points describe a process and no demo follows within two scenes, insert a `flow` demo.

Honest note on "3D in every lesson": true 3D helps when the subject has spatial structure (memory, circuits, tensors, networks, loss surfaces). For flat ideas (number bases, Boolean algebra) the 3D stage is used as a 2.5D isometric board with camera moves. That keeps the promise without forcing fake depth. See open question 3.

### C5. Narration and playback sync

- The actions prompt gets a "demo walk" rule modelled on the existing diagram walk: emit `widget_setState { "state": { "step": "<id>" } }` immediately before the speech for that step. No new action type, so stored lessons and the standalone player keep working.
- The kit handles `SET_WIDGET_STATE` with `state.step` by tweening to that step's label. Animations are capped so they finish inside the sentence that follows.
- Kit to host messages (validated against the frame window, like the existing picker and media bridges): `demo:step` when the learner scrubs or presses next/back; `demo:checkpoint` open/answered.
- Scrubbing in the demo moves the lecture: the host maps the step id to the matching action index and calls the existing jump (`handleJumpToAction` in `PlaybackChromeRoot.tsx`, `lib/playback/action-navigation.ts`).
- A checkpoint pauses the playback engine until answered or skipped.
- The kit writes its current step and control values into the existing observation attribute, so the chat agent can already answer "why is the carry 1 here?" about the exact state on screen.

### C6. Click anything to ask

Today (verified): press the pick toggle in the toolbar, click an element, a reference pill appears in the input, type the question, send. The plumbing is `sendMessageWithElementReference` (`PlaybackChromeRoot.tsx:366`), `handlePickElement` (1570), `handlePickInteractiveComponent` (1644), `components/canvas/slide-element-pick-overlay.tsx`, behind `NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED`.

Target: one gesture, no mode.

| Where | Gesture | Result |
|---|---|---|
| Slide element | Alt+click, right-click, or the small "?" chip that appears on hover | Quick-ask popover anchored to the element |
| Demo object (3D or SVG) | Same; the kit raycasts and posts `demo:ask { id, label, ask, step }` | Same popover, with the demo's current state attached |
| Notes / transcript text | Select text | "Ask about this" chip |
| Anywhere | `/` | Focus the ask box for the current scene |

Popover contents: the element's label, four one-click prompts (Explain this, Why?, Give an example, Quiz me on this), and a free-text field. Enter sends through the existing `sendMessageWithElementReference`. Playback pauses while the popover is open and resumes when the answer ends. Plain click on a slide keeps toggling play/pause as today.

---

## D. Classroom UI redesign

Rules for every UI story: full width (no centred `max-w-*` column); flat solid colours, no gradients (the classroom chrome currently has 81 gradient usages across `components/{stage,roundtable,chat,canvas,edit,classroom,scene-renderers}`); comfortable light and deep-dark themes with soft contrast; monochrome icons, accent colour only on the active one; hover feedback on every control; one collapse control per panel. Story 2.1 writes the house guide (`docs/fork-plan/UI.md`) and every later UI story starts from it.

### D1. Default layout (1920 x 1080 browser, about 1920 x 928 viewport)

```
+----+--------------------------------------------------------------------+---------------------+
| ## | < Back   Why Computers Speak in Bits and Bytes      EN  Theme  ?  [] | Notes | Chat | Ask   |  40px bar
|rail+--------------------------------------------------------------------+---------------------+
| 01 |                                                                    |  transcript lines,  |
| 02 |                                                                    |  current line       |
| 03*|                 STAGE: true 16:9, slide at 100%                    |  highlighted,       |
| 04 |                 (about 1290 x 726 at this size)                    |  click a line to    |
| 05 |                                                                    |  jump there         |
| .. |                                                                    |                     |
|    +--------------------------------------------------------------------+                     |
|    | Dr. Hale: "Welcome, everyone. I'm glad you're here ..."   (caption) |                     |  56px band
|    +--------------------------------------------------------------------+---------------------+
|    | |<  >  >|   2/29  step 3/7  =====o--------   1x  Vol   Pick  Board  Fullscreen           |  44px transport
+----+--------------------------------------------------------------------+---------------------+
 56px                        flexible                                         320-560px, resizable
```

- Three resizable regions built with `react-resizable-panels` (already installed and used in `components/scene-renderers/pbl/v3/workbench-split.tsx`): outline rail, stage column, side panel. Sizes persist.
- The agent dock (avatars, mic, input) moves into the side panel's Chat tab. The stage column keeps only the caption band and one transport bar. This returns about 190 px of height to the slide.
- The rail shows scene numbers with a type glyph (slide, quiz, demo); it expands on hover or with `[` to titles and thumbnails.

### D2. Focus mode (`F`)

```
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|                               STAGE fills the window, 16:9 contained                          |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
| Dr. Hale: "Each extra bit doubles the number of patterns."                          (caption) |
+-----------------------------------------------------------------------------------------------+
   transport bar appears on mouse move, hides after 3 s (existing idle timer)
```

Fullscreen (`Shift+F` or F11) is the same layout on the fullscreen element. The caption band is reserved space, so it never covers the slide. `T` switches to float, pill or off.

### D3. Demo scene

```
+--------------------------------------------------------------------+---------------------+
|                                                    [reset] [?]      | Notes               |
|            3D stage (drag to orbit, scroll to zoom)                 |  > Flip A to 1      |
|                 A --+                                               |    (linked to wire) |
|                     XOR ---- SUM                                    |                     |
|                 B --+                                               |                     |
|  [A: 0|1]  [B: 0|1]                         sum = 1   carry = 0     |                     |
+--------------------------------------------------------------------+                     |
| step  1 --- 2 --- (3) --- 4 --- 5      "Flip A to 1"                |                     |
+--------------------------------------------------------------------+---------------------+
```

### D4. Quick-ask popover

```
              +----------------------------------------+
   [ XOR ]----| XOR gate                               |
              | [Explain this] [Why?] [Example] [Quiz] |
              | Ask anything about this...        [->] |
              +----------------------------------------+
```

### D5. Keyboard

| Key | Action | Today |
|---|---|---|
| Space | Play / pause | Exists |
| Left / Right | Previous / next step, then scene | Exists only in fullscreen (`PlaybackChromeRoot.tsx`, about lines 1768-1780); make it work always when no input has focus |
| Shift+Left / Shift+Right | Previous / next scene | New |
| `,` / `.` | Demo step back / forward | New |
| Up / Down, `M` | Volume, mute | Exists |
| `F`, `Shift+F` / F11, Esc | Focus, fullscreen, leave | F11 and Esc exist |
| `[` / `]` | Toggle rail / side panel | `C` toggles chat today; keep it as an alias |
| `N` / `C` / `/` | Notes tab / Chat tab / ask box | New |
| `T` | Cycle caption mode | New |
| `R` | Replay current step | New |
| `?` | Shortcut sheet | New |

### D6. Colour and theme

Tokens already live in `app/globals.css` (`--primary: #722ed1` light, `#8b47ea` dark, `.dark` block at line 104). Story 2.1 defines the fork palette as token overrides only: one accent, three semantic colours (correct, wrong, warning), neutral surfaces in OKLCH, a soft-white light theme and a soft near-black dark theme. Components reference tokens, never raw colours. Gradients in the classroom chrome are replaced by solid tokens in the stories that own those files.

---

## E. Phased plan

Conventions:

- One story is about one dev-day and lists the files it owns. Two stories that share no files can run in parallel, each in its own worktree.
- **Hot files** (`components/edit/PlaybackChromeRoot.tsx`, 2307 lines; `components/roundtable/index.tsx`, 2419 lines): only one story at a time may own each. New behaviour goes into new files; the hot file gets a few lines of wiring. That also keeps `git merge upstream/main` workable.
- Tests: `pnpm vitest run <file>` for unit tests (`tests/**/*.test.ts`), `pnpm test:e2e -- e2e/tests/<spec>` for Playwright (config uses port 3002 and starts `pnpm dev`). Test runs, Playwright and screenshots belong on the dev VM, not the laptop.
- UI stories are checked with forced data states (0, 1, many scenes; long titles; long caption; error; loading), in both themes, at 1920 x 1080 and 1366 x 768.
- `@openmaic/*` packages are published upstream and normally need a version bump per change. The fork does not publish, so no bumps; `pnpm check:package-versions` will complain and can be ignored locally.
- Model per story: Sonnet 5.5 for scoped coding, Opus 5.5 for 3D and motion work.

### Phase 1: bugs and provider (ship first)

Parallel lanes: {1.1, 1.3, 1.5, 1.6} can start together. 1.2 and 1.4 follow 1.1 (shared files). 1.7 follows 1.6. 1.8 is last.

| ID | Story | Model | Owns | Acceptance | Verify |
|---|---|---|---|---|---|
| 1.1 | Full-bleed, true 16:9 stage (A1, A2) | Sonnet | `components/canvas/canvas-area.tsx`, `lib/workbench/use-workbench-pro-edit.ts` (rename), one import line in `PlaybackChromeRoot.tsx` | Slide width equals stage box width (within 2 px) on the classroom page; stage box is 16:9 with chat open at 560 px and at a 1100 px window; editor still shows its 90% margin | New Playwright spec `e2e/tests/stage-fit.spec.ts` measuring both boxes at three viewport sizes and panel states |
| 1.2 | Render-time slide fit guard (A3 layer 1) | Sonnet | `components/slide-renderer/Editor/ScreenCanvas.tsx`, `RendererScreenCanvas.tsx`, new `lib/slide/fit-guard.ts` | The scene from `stage-fs0_tygHfAAs` shows the whole "Watch out" box; slides that already fit are pixel-identical | Vitest on the pure scale function; Playwright with a fixture slide whose text overflows by 30 px and by 150 px |
| 1.3 | Generation layout guard (A3 layer 2) | Sonnet | new `packages/@openmaic/generation/src/layout-guard.ts`, a call site in `scene-generator.ts`, `tests/generation/layout-guard.test.ts` | For the recorded elements of the scene above, output has no text box shorter than its estimated lines and no element bottom past canvas height minus margin; idempotent | Vitest with that scene's element list as a fixture, plus a CJK case and a long-title case |
| 1.4 | Caption modes: band, float (draggable), pill, off; persisted (A5) | Sonnet | `components/roundtable/presentation-speech-overlay.tsx`, new `components/roundtable/caption-band.tsx`, `lib/store/settings.ts`, about ten lines in `components/roundtable/index.tsx` and `PlaybackChromeRoot.tsx` (after 1.1 merges) | In fullscreen at 1920 x 1080 the caption and the slide rectangles do not intersect in `band` mode; in `float` the bubble can be dragged and stays inside the stage; mode and position survive reload; `T` cycles | Playwright: bounding-box intersection test in fullscreen and with the dock folded; long caption (600 characters) and no-caption states |
| 1.5 | `claude-cli` model core (B3) | Sonnet (high) | new `lib/ai/claude-cli/*`, `tests/ai/claude-cli-*.test.ts`, `tests/fixtures/fake-claude.mjs` | `doGenerate` and `doStream` return correct text, finish reason and usage from recorded NDJSON; child env has no `ANTHROPIC_*`; abort stops the child within 2 s; a `rate_limit_event` with a rejected status becomes a non-retryable error naming the reset time; calls with tools throw | Vitest only, against the fake CLI script (no network, no real CLI) |
| 1.6 | Register provider, preset, thinking mapping (B3) | Sonnet | `lib/types/provider.ts`, `lib/ai/providers.ts`, `lib/config/provider-presets.ts`, `lib/ai/thinking-config.ts`, the two guard tests | `getModel({ providerId: 'claude-cli', modelId: 'sonnet' })` returns a model with `outputWindow` set; effort maps to `--effort` and never above `high`; `openmaic.yml` with the block in B3 loads without validation errors; guard tests pass | Vitest: `tests/ai/`, `tests/providers/`, `tests/config/` files touched |
| 1.7 | Switch local config, fix the 4096 cap | Sonnet | `openmaic.yml`, `.env.local` (add `PARALLEL_SCENE_CONCURRENCY=2`, `CLAUDE_CLI_PATH`), `docs/fork-plan/PROVIDER.md` | Slots as in B3; the API-key Anthropic entry lists a catalogued model, so no call is capped at 4096 output tokens | Start the app, open Settings, confirm each slot shows the expected provider |
| 1.8 | End-to-end generation check and measurements | Sonnet | none (report only), small fixes back to 1.5 | A 6-scene lesson generates fully through the CLI; record wall time, calls made, peak memory per CLI process, share of the weekly limit used; cancel mid-run leaves no `claude` child running | Manual run with the numbers written into `PROVIDER.md` |

### Phase 2: classroom UI (D)

2.1 first. Then 2.2 owns the hot files; 2.3 and 2.4 follow it; 2.5 runs last.

| ID | Story | Model | Owns | Acceptance | Verify |
|---|---|---|---|---|---|
| 2.1 | House UI guide and tokens | Sonnet | new `docs/fork-plan/UI.md`, `app/globals.css` (token block only) | Guide covers layout, type scale, spacing, palette, icon rules, states; light and dark tokens defined; no component changes | Side-by-side screenshots of one page before and after in both themes |
| 2.2 | Layout shell: rail, stage, side panel, resizable and persisted (D1) | Sonnet (high) | new `components/classroom/shell/*`, wiring in `PlaybackChromeRoot.tsx`, `components/stage/scene-sidebar.tsx` | Three regions resize and remember sizes; no horizontal scroll at 1366 px; stage is at least 60% of viewport height at 1920 x 928 with the side panel open | Playwright layout assertions at two sizes; data states 0, 1 and 40 scenes |
| 2.3 | Dock into the Chat tab; one transport bar; caption band in normal mode | Sonnet (high) | `components/roundtable/index.tsx`, `components/canvas/canvas-toolbar.tsx`, `components/chat/chat-area.tsx` | Mic, input and avatars work from the side panel; a discussion still starts, pauses and ends; transport bar is the only bar under the stage | Existing `e2e/tests/classroom-interaction.spec.ts` plus a new spec for the moved controls |
| 2.4 | Focus and fullscreen modes, shortcut map, `?` sheet (D2, D5) | Sonnet | new `lib/classroom/shortcuts.ts`, new `components/classroom/shortcut-sheet.tsx`, the keydown effect in `PlaybackChromeRoot.tsx` | Every key in D5 works; none fire while typing in an input; arrows work outside fullscreen | Vitest on the key map; Playwright key presses |
| 2.5 | Flat-colour pass and data-state audit | Sonnet | class names only, in `components/{stage,chat,canvas,classroom}` and `components/stage/header-controls.tsx` | Zero `bg-gradient`, `linear-gradient`, `radial-gradient` in those folders; active icon uses the accent, the rest are monochrome | `grep` count is 0; screenshot set for all data states in both themes |

### Phase 3: demo kit (C3-C5)

3.1 and 3.2 start together. 3.3 and 3.4 need 3.2. 3.5 needs 3.1. 3.6 needs 3.2 and 3.5. Preset batches can run in parallel with each other once 3.2 is merged, because each preset is its own file.

| ID | Story | Model | Owns | Acceptance | Verify |
|---|---|---|---|---|---|
| 3.1 | DemoSpec schema, validator, HTML shell builder; confirm the 3D listener mismatch (C2 gap 2) | Sonnet | new `packages/@openmaic/generation/src/demo-spec.ts`, `demo-shell.ts`, tests | Valid specs pass; unknown fields are dropped; invalid specs return precise errors; shell output loads the kit URL and embeds the spec safely (no `</script>` break-out) | Vitest, including a hostile-string case |
| 3.2 | Kit core: 3D stage, primitives, step timeline, scrubber, controls, message bridge, theme, pause when hidden | Opus | new `lib/demo-kit/core/*`, `scripts/build-demo-kit.mjs`, one line in the `dev` and `build` scripts | A hand-written spec renders in `app/sandbox-lab`; steps play forward, back and by scrub; `SET_WIDGET_STATE {step}` moves it; render loop stops when hidden; fits 1280 x 720 with no scroll | Vitest on the timeline builder; Playwright screenshot per step for two fixture specs |
| 3.3 | Flow engine: SVG and 2.5D board, layered layout, tokens moving on edges | Opus | new `lib/demo-kit/flow/*` | 5, 12 and 30 node graphs lay out without overlap; a token travels an edge per step; long labels wrap | Playwright screenshots for the three sizes |
| 3.4 | Presets batch 1: `bit-register`, `logic-circuit`, `memory-grid`, `data-structure` | Opus | new `lib/demo-kit/presets/<name>.ts`, one file each | Each preset expands to a valid spec from at most six parameters and is correct (adder truth table, two's complement values, pointer targets) | Vitest on the expanded specs' logic; one screenshot each |
| 3.5 | Generation: demo templates, routing flag, outline rule and deterministic check (C4) | Sonnet (high) | new `packages/@openmaic/generation/templates/{demo3d-content,demoflow-content}/`, routing in `scene-generator.ts`, `lib/server/generation/steps/outline.ts`, a fork snippet for the outline prompt | With the flag on, a `visualization3d` outline yields a valid spec scene; an outline with no demo gets one added; bad spec falls back to a preset | Vitest with recorded model outputs (good, malformed, missing demo); one real 6-scene lesson |
| 3.6 | Narration sync: demo walk in the actions prompt, step messages, scrub-to-jump, checkpoints (C5) | Sonnet (high) | new `templates/demo-actions/`, new `lib/interactive/demo-bridge.ts`, wiring in `InteractiveIframeHost.tsx` and `PlaybackChromeRoot.tsx` | Each speech segment is preceded by its step; scrubbing to step 4 moves the lecture to step 4's speech; a checkpoint pauses and resumes playback | Vitest on the step-to-action map; Playwright on a fixture lesson |
| 3.7 | Presets batch 2: `cpu-datapath`, `packet-layers`, `algo-trace` | Opus | one file each under `lib/demo-kit/presets/` | As 3.4 | As 3.4 |
| 3.8 | Presets batch 3: `surface-plot`, `tensor`, `neural-net`, `embedding-space`, `attention` | Opus | one file each under `lib/demo-kit/presets/`, `lib/demo-kit/core/expr.ts` | As 3.4; gradient descent path matches a numeric reference; the expression parser rejects anything outside its whitelist | Vitest, including parser rejection cases |

### Phase 4: click anything to ask (C6)

4.1 and 4.2 can run in parallel after Phase 2; 4.3 is independent.

| ID | Story | Model | Owns | Acceptance | Verify |
|---|---|---|---|---|---|
| 4.1 | Quick-ask on slide elements | Sonnet | new `components/classroom/quick-ask.tsx`, `components/canvas/slide-element-pick-overlay.tsx`, a few lines in `PlaybackChromeRoot.tsx` | Alt+click, right-click and the hover chip open the popover on the right element; a preset sends a message carrying that element reference; playback pauses and resumes; plain click still toggles play | Extend `e2e/tests/interactive-component-reference.spec.ts` patterns in a new spec |
| 4.2 | Quick-ask on demo objects | Sonnet | `lib/demo-kit/core/pick.ts`, `lib/interactive/demo-bridge.ts` | Clicking a 3D object or SVG node opens the same popover with the object's label and the current step attached; messages from any other frame are ignored | Playwright on the two fixture specs; a forged-message test |
| 4.3 | Ask from selected text, `/` to ask, notes-to-object hover link | Sonnet | `components/chat/lecture-notes-view.tsx`, `lib/classroom/shortcuts.ts` | Selecting transcript text shows the chip; hovering a notes line highlights its demo object and the reverse | Playwright |

### Phase 5: optional

| ID | Story | Model | Note |
|---|---|---|---|
| 5.1 | Live chat through the subscription: emulate tool calls in the CLI provider | Opus | About two days, less reliable than native tool calling. Only if the owner wants zero API-key usage (open question 1). |
| 5.2 | Vision input for the CLI provider | Sonnet | stream-json input with image blocks; needed only for lessons generated from PDFs or images. |
| 5.3 | Add demos to already generated lessons | Sonnet | Generate and insert demo scenes into an existing course without regenerating slides (open question 4). |

---

## F. Open questions for the owner

1. **Live chat on the API key?** Generation moves to the subscription. Live classroom chat and quiz grading need tool calling, which the CLI cannot do natively, so the plan keeps them on the Anthropic API key (small spend). Is that acceptable, or should story 5.1 (emulated tool calls, about two days, less reliable) be built so that nothing uses the API key?
2. **Model split and weekly limit.** Planned: Opus for outline and demos, Sonnet for slides and narration, Haiku for agent profiles, two scenes at a time. Lesson generation will draw from the same weekly limit as your daily Claude Code work. Is that split right, or should lessons use Sonnet throughout to protect the limit?
3. **What counts as 3D.** For topics with no spatial structure (number bases, Boolean algebra), is an animated 2.5D board in the 3D stage enough to satisfy "3D in every lesson", or do you want a true 3D model in every lesson even when it is decorative?
4. **Existing lessons.** Two courses exist locally (2 and 29 scenes). Regenerate them once the demo kit lands, add demo scenes to them in place (story 5.3), or leave them?
5. **Upstream merges.** The redesign rewrites the layout around two large files that upstream changes often. Keep merging `upstream/main` (slower, additive changes only) or freeze the fork at v1.5.0-rc.3 and diverge freely?

---

## Sources for section B

- Claude Code headless mode: https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Environment variables: https://code.claude.com/docs/en/env-vars
- Agent SDK overview (login and branding note): https://code.claude.com/docs/en/agent-sdk/overview
- Streaming input and images: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Using the Agent SDK with a Claude plan: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

## G. Owner decisions (2026-11-22)

1. Live classroom chat and quiz grading stay on the Anthropic API key; all generation slots use the `claude-cli` provider. Story 5.1 is dropped.
2. Model split: Opus for outline and demos, Sonnet for slides and narration, Haiku for agent profiles; two scenes at a time.
3. Non-spatial topics may use an animated 2.5D board; real 3D wherever the topic has structure.
4. The fork freezes at v1.5.0-rc.3 and diverges freely; no `upstream/main` merges. Hot-file "additive only" rules are relaxed, but one story per hot file at a time still holds.
5. Existing lessons: only the 29-scene course remains (the 2-scene one was deleted). Leave it; 5.3 stays optional.

### Review follow-ups for presets (from 3.4 review, 2026-11-23) — fold into 3.7
- memory-grid: pointer arrows route through neighbouring cells (p→x passes over y); route them above the row with a curve. Long values (e.g. `0x100`) overflow the cell — scale the label to fit.
- data-structure (tree): the coloured status plates behind nodes are offset and read as misaligned shadows; centre them or use an outline ring.
- Replace the U+2060 trick that stops 0/1 values being coloured as logic bits with an explicit per-object flag in the schema (e.g. `valueStyle: "number" | "bit"`).
