/**
 * Demo-kit generation (PLAN.md C3, C4; story 3.5).
 *
 * Behind `OPENMAIC_DEMO_KIT=1`, `visualization3d` and `diagram` interactive
 * scenes ask the model for ONE DemoSpec JSON instead of a free-form HTML page.
 * The spec is validated, retried once with the errors fed back, and replaced by
 * a preset (or a key-point flow) when it is still invalid, so a lesson never
 * ships a broken demo. The stored scene HTML is the fixed shell from
 * buildDemoShell, which loads the vetted kit.
 *
 * `ensureDemoOutline` is the deterministic half of C4: an outline without a
 * demo scene gets one after its first concept slide.
 */
import type { WidgetType } from '@openmaic/dsl';
import { buildDemoShell } from './demo-shell.js';
import { validateDemoSpec, type DemoSpec } from './demo-spec.js';
import { PRESET_PARAMS, PRESET_NAMES, type PresetName } from './demo-presets.js';
import { interactiveAssetBaseUrl } from './interactive-libraries.js';
import { postProcessInteractiveHtml } from './interactive-post-processor.js';
import { parseJsonResponse } from './json-repair.js';
import { noopGenerationLogger, type GenerationLogger } from './logger.js';
import type { SceneOutline } from './outline-types.js';
import type { AICallFn } from './pipeline-types.js';
import { buildPrompt, PROMPT_IDS } from './prompts/index.js';
import type { GeneratedInteractiveContent } from './scene-types.js';

/** Widget types that become demo-kit demos when the flag is on. */
export const DEMO_WIDGET_TYPES: readonly WidgetType[] = ['visualization3d', 'diagram'];

/**
 * After this long on the first call, skip the retry and fall back at once, so
 * two model calls never outlast the scene-content step's 600 s deadline.
 */
const RETRY_BUDGET_MS = 240_000;
const MAX_FALLBACK_NODES = 8;

export function isDemoKitEnabled(): boolean {
  try {
    return process.env.OPENMAIC_DEMO_KIT === '1';
  } catch {
    return false;
  }
}

export function demoKitUrl(baseUrl = interactiveAssetBaseUrl()): string {
  return `${baseUrl.replace(/\/$/, '')}/demo-kit@1/demo-kit.js`;
}

type Errors = { path: string; message: string }[];
type Checked = { ok: true; spec: DemoSpec } | { ok: false; errors: Errors };

/** validateDemoSpec plus the preset name and params the kit needs to expand it. */
export function checkDemoSpec(raw: unknown): Checked {
  if (raw === null || typeof raw !== 'object')
    return { ok: false, errors: [{ path: '', message: 'reply is not a JSON object' }] };
  const result = validateDemoSpec(raw);
  if (!result.ok || result.spec.kind !== 'preset') return result;
  const name = result.spec.preset as PresetName;
  if (!PRESET_NAMES.includes(name))
    return {
      ok: false,
      errors: [
        { path: 'preset', message: `unknown preset; use one of ${PRESET_NAMES.join(', ')}` },
      ],
    };
  const params = PRESET_PARAMS[name].safeParse(result.spec.params ?? {});
  if (!params.success)
    return {
      ok: false,
      errors: params.error.issues.map((i) => ({
        path: ['params', ...i.path].join('.'),
        message: i.message,
      })),
    };
  return { ok: true, spec: { ...result.spec, params: params.data } };
}

/** Keywords that pick a fallback preset; the most hits wins, ties go to the earlier preset. */
const PRESET_KEYWORDS: Record<PresetName, RegExp> = {
  'logic-circuit':
    /\b(logic gates?|gates?|boolean|adders?|xor|nand|nor|circuits?|latch|flip-?flops?|multiplexers?|mux)\b/gi,
  'bit-register':
    /\b(binary|bits?|bytes?|two'?s complement|registers?|hexadecimal|hex|number bases?|base 2|overflow)\b/gi,
  'memory-grid':
    /\b(memory|pointers?|address(es)?|stack frames?|heap|ram|call stack|dereference)\b/gi,
  'data-structure':
    /\b(arrays?|linked lists?|trees?|bst|hash( tables?|ing)?|queues?|stacks?|data structures?|nodes?)\b/gi,
};

/** The preset whose keywords the outline mentions most, or null when none match. */
export function pickFallbackPreset(outline: SceneOutline): PresetName | null {
  const text = [
    outline.title,
    outline.description,
    ...(outline.keyPoints ?? []),
    outline.widgetOutline?.concept ?? '',
    ...(outline.widgetOutline?.objects ?? []),
  ].join(' ');
  let best: PresetName | null = null;
  let bestHits = 0;
  for (const name of PRESET_NAMES) {
    const hits = text.match(PRESET_KEYWORDS[name])?.length ?? 0;
    if (hits > bestHits) [best, bestHits] = [name, hits];
  }
  return best;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Spec used when the model's spec is still invalid after the retry: the
 * best-matching preset with default params, else a flow that walks the
 * outline's key points (always on topic, always valid).
 */
export function fallbackDemoSpec(outline: SceneOutline): DemoSpec {
  const title = clip(outline.title || 'Demo', 200);
  const preset = pickFallbackPreset(outline);
  if (preset)
    return {
      version: 1,
      kind: 'preset',
      preset,
      params: {},
      title,
      objects: [],
      steps: [],
      controls: [],
    };

  const points = (outline.keyPoints ?? []).filter((p) => p.trim()).slice(0, MAX_FALLBACK_NODES);
  if (!points.length) points.push(title);
  const nodes = points.map((p, i) => ({
    id: `k${i}`,
    type: 'node' as const,
    label: clip(p, 60),
    ask: clip(p, 500),
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    type: 'edge' as const,
    from: `k${i}`,
    to: n.id,
  }));
  return {
    version: 1,
    kind: 'flow',
    title,
    direction: points.length > 4 ? 'down' : 'right',
    objects: [...nodes, ...edges, { id: 'tok', type: 'token', from: 'k0' }],
    steps: points.map((p, i) => ({
      id: `s${i + 1}`,
      caption: clip(p, 500),
      ...(i ? { travel: { tok: `e${i - 1}` } } : {}),
      highlight: [`k${i}`],
    })),
    controls: [],
  };
}

function demoPromptVariables(outline: SceneOutline, languageDirective?: string) {
  const w = outline.widgetOutline ?? {};
  const hints = [
    w.concept && `Concept: ${w.concept}`,
    w.visualizationType &&
      w.visualizationType !== 'custom' &&
      `Visualization type: ${w.visualizationType}`,
    w.objects?.length && `Objects the outline names: ${w.objects.join(', ')}`,
    w.interactions?.length && `Interactions the outline names: ${w.interactions.join(', ')}`,
    w.diagramType && `Diagram type: ${w.diagramType}`,
    w.nodes?.length && `Nodes the outline names: ${w.nodes.map((n) => n.label).join(', ')}`,
    w.designIdea && `Design idea: ${w.designIdea}`,
  ].filter(Boolean);
  return {
    title: outline.title,
    description: outline.description || '',
    keyPoints: (outline.keyPoints ?? []).map((p) => `- ${p}`).join('\n') || '(none)',
    outlineHints: hints.join('\n') || '(none)',
    languageDirective: languageDirective || '',
  };
}

/** Generate one demo scene: spec -> validate -> one retry -> fallback -> HTML shell. */
export async function generateDemoContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  languageDirective?: string,
  logger: GenerationLogger = noopGenerationLogger,
): Promise<GeneratedInteractiveContent | null> {
  const widgetType = outline.widgetType === 'diagram' ? 'diagram' : 'visualization3d';
  const promptId =
    widgetType === 'diagram' ? PROMPT_IDS.DEMOFLOW_CONTENT : PROMPT_IDS.DEMO3D_CONTENT;
  const prompts = buildPrompt(promptId, demoPromptVariables(outline, languageDirective));
  if (!prompts) {
    logger.error(`Failed to build ${promptId} prompt for: ${outline.title}`);
    return null;
  }

  logger.info(`Generating demo-kit ${widgetType} demo for: ${outline.title}`);
  const started = Date.now();
  const first = await aiCall(prompts.system, prompts.user);
  let checked = checkDemoSpec(parseJsonResponse<unknown>(first, { logger }));

  if (!checked.ok && Date.now() - started < RETRY_BUDGET_MS) {
    const errors = checked.errors.map((e) => `- ${e.path || '(root)'}: ${e.message}`).join('\n');
    logger.warn(`Demo spec for "${outline.title}" is invalid, retrying once:\n${errors}`);
    const retryUser = `${prompts.user}

## Your previous reply was rejected

It failed validation with these errors:
${errors}

Your previous reply:
${first.slice(0, 20_000)}

Reply again with the corrected DemoSpec: one JSON object only, fixing every error above.`;
    checked = checkDemoSpec(
      parseJsonResponse<unknown>(await aiCall(prompts.system, retryUser), { logger }),
    );
  }

  let spec: DemoSpec;
  if (checked.ok) spec = checked.spec;
  else {
    spec = fallbackDemoSpec(outline);
    logger.warn(
      `Demo spec for "${outline.title}" is still invalid; using fallback ${spec.kind === 'preset' ? `preset "${spec.preset}"` : 'key-point flow'}`,
    );
  }

  const html = buildDemoShell(spec, {
    kitUrl: demoKitUrl(),
    title: spec.title,
    lang: 'en',
  });
  return { html: postProcessInteractiveHtml(html), widgetType };
}

const isDemo = (o: SceneOutline) =>
  o.type === 'interactive' && !!o.widgetType && DEMO_WIDGET_TYPES.includes(o.widgetType);

/**
 * C4 deterministic check: when no scene is a demo, insert a `visualization3d`
 * demo after the first concept slide (the second slide when the lesson has
 * three or more, since the first is usually the opener; else the first). The
 * demo reuses that slide's title and key points, so it is in the lesson's
 * language. Orders are renumbered 1..n. Returns the input when nothing changes.
 */
export function ensureDemoOutline(outlines: SceneOutline[]): SceneOutline[] {
  if (outlines.some(isDemo)) return outlines;
  const slides = outlines.filter((o) => o.type === 'slide');
  const anchor = slides.length >= 3 ? slides[1] : slides[0];
  if (!anchor) return outlines;

  const ids = new Set(outlines.map((o) => o.id));
  let id = `${anchor.id}-demo`;
  for (let n = 2; ids.has(id); n++) id = `${anchor.id}-demo-${n}`;
  const demo: SceneOutline = {
    id,
    type: 'interactive',
    title: anchor.title,
    description: anchor.description,
    keyPoints: [...(anchor.keyPoints ?? [])],
    order: 0,
    widgetType: 'visualization3d',
    widgetOutline: { visualizationType: 'custom', concept: anchor.title },
  };
  const at = outlines.indexOf(anchor) + 1;
  return [...outlines.slice(0, at), demo, ...outlines.slice(at)].map((o, i) => ({
    ...o,
    order: i + 1,
  }));
}
