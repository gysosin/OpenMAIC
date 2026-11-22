/**
 * Message bridge between the kit (inside the sandboxed interactive iframe) and
 * the classroom host.
 *
 * In:  SET_WIDGET_STATE { state: { step } }  (the existing widget_setState action;
 *      a top-level `step` is accepted too), SET_THEME { theme: 'light' | 'dark' }.
 * Out: DEMO_READY { steps }, DEMO_STEP_CHANGED { step, index },
 *      DEMO_ASK { objectId, label, ask, step }, DEMO_CHECKPOINT { stepId, correct }.
 *
 * The iframe is sandboxed without allow-same-origin, so its origin is opaque
 * and an origin string check means nothing; incoming messages are accepted
 * only from the parent window (event.source), and their shape is checked.
 * Outgoing messages carry no secrets, so they are posted to '*'.
 */

export type HostMessage =
  | { type: 'SET_WIDGET_STATE'; step: string | number }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' };

export type KitMessage =
  | { type: 'DEMO_READY'; steps: string[] }
  | { type: 'DEMO_STEP_CHANGED'; step: string; index: number }
  | { type: 'DEMO_ASK'; objectId: string; label: string; ask: string; step: string }
  | { type: 'DEMO_CHECKPOINT'; stepId: string; correct: boolean };

const MAX_ID = 200;

function stepRef(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID) return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

/** Shape check for host messages; anything else (other widgets' traffic too) is null. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.type === 'SET_WIDGET_STATE') {
    const state = message.state;
    const nested =
      state && typeof state === 'object' ? (state as Record<string, unknown>).step : undefined;
    const step = stepRef(nested ?? message.step);
    return step === undefined ? null : { type: 'SET_WIDGET_STATE', step };
  }
  if (message.type === 'SET_THEME') {
    const theme = message.theme;
    return theme === 'light' || theme === 'dark' ? { type: 'SET_THEME', theme } : null;
  }
  return null;
}

/** Listens for host messages from the parent window only. Returns the unsubscribe. */
export function listenToHost(onMessage: (message: HostMessage) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent) return;
    const message = parseHostMessage(event.data);
    if (message) onMessage(message);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function postToHost(message: KitMessage): void {
  if (window.parent !== window) window.parent.postMessage({ source: 'demo-kit', ...message }, '*');
}
