'use client';
import { useEffect, useRef, useState } from 'react';

import { buildDemoShell } from '@openmaic/generation/browser';

import { expandPreset } from '@/lib/demo-kit/presets';

import { DEMO_FIXTURES, DEMO_KIT_URL, PRESET_FIXTURES } from './fixtures';

const FIXTURES = { ...DEMO_FIXTURES, ...PRESET_FIXTURES };
type FixtureName = keyof typeof FIXTURES;
const NAMES = Object.keys(FIXTURES) as FixtureName[];
/** Step ids per fixture; preset specs list theirs only once expanded. */
const STEPS = Object.fromEntries(
  NAMES.map((name) => {
    const spec = FIXTURES[name];
    return [name, ((spec.kind === 'preset' ? expandPreset(spec) : spec)?.steps ?? []).map((s) => s.id)];
  }),
) as Record<FixtureName, string[]>;

/**
 * Loads each fixture spec in the same sandboxed iframe the classroom uses
 * (`allow-scripts`, no same-origin) and drives it through the host messages.
 */
export default function DemoKitLab() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [log, setLog] = useState<string[]>([]);
  const frames = useRef<Partial<Record<FixtureName, HTMLIFrameElement | null>>>({});
  // The shell is built once with the starting theme; later changes go through SET_THEME.
  const [shells] = useState(() =>
    Object.fromEntries(
      NAMES.map((name) => [
        name,
        buildDemoShell(FIXTURES[name], { kitUrl: DEMO_KIT_URL, title: name, lang: 'en' }).replace(
          '<html ',
          '<html data-theme="dark" ',
        ),
      ]),
    ),
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const name = NAMES.find((n) => frames.current[n]?.contentWindow === event.source);
      if (!name || event.data?.source !== 'demo-kit') return;
      setLog((rows) => [`${name}: ${JSON.stringify(event.data)}`, ...rows].slice(0, 30));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function send(name: FixtureName, message: Record<string, unknown>) {
    frames.current[name]?.contentWindow?.postMessage(message, '*');
  }

  function switchTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    for (const name of NAMES) send(name, { type: 'SET_THEME', theme: next });
  }

  return (
    <main className="flex w-full flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Demo kit fixtures</h1>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={switchTheme}
          data-testid="demo-theme"
        >
          Theme: {theme}
        </button>
      </header>
      <div className="grid w-full gap-6 xl:grid-cols-2">
        {NAMES.map((name) => (
          <section key={name} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{name}</span>
              {STEPS[name].map((step) => (
                <button
                  key={step}
                  type="button"
                  className="rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted"
                  onClick={() => send(name, { type: 'SET_WIDGET_STATE', state: { step } })}
                >
                  {step}
                </button>
              ))}
            </div>
            <iframe
              ref={(node) => {
                frames.current[name] = node;
              }}
              title={name}
              data-fixture={name}
              sandbox="allow-scripts"
              srcDoc={shells[name]}
              className="aspect-video w-full rounded-lg border"
            />
          </section>
        ))}
      </div>
      <pre data-testid="demo-log" className="max-h-64 overflow-auto rounded border p-3 font-mono text-xs">
        {log.join('\n')}
      </pre>
    </main>
  );
}
