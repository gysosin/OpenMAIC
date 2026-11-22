/**
 * The chrome around the stage: title, live controls (toggle / slider), the
 * checkpoint card, the step caption and the transport (prev, play, next and a
 * scrubber with one tick per step). Plain DOM with textContent only.
 */
import type { Checkpoint, DemoControl, Scalar } from './types';
import { truthy } from './timeline';

export const STYLES = `
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--dk-canvas)}
body{font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--dk-text);-webkit-font-smoothing:antialiased}
.dk-root{position:fixed;inset:0;overflow:hidden;background:var(--dk-canvas)}
.dk-stage{position:absolute;inset:0}
.dk-canvas,.dk-labels{position:absolute;inset:0;width:100%!important;height:100%!important}
.dk-labels{touch-action:none}
.dk-labels>div{pointer-events:none}
.dk-label{font-weight:550;font-size:13px;letter-spacing:.01em;color:var(--dk-text);white-space:nowrap;
  text-shadow:0 0 3px var(--dk-canvas),0 0 6px var(--dk-canvas);transition:color .25s}
.dk-label--free{font:600 30px/1 ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;letter-spacing:-.01em}
.dk-label--gate{font:600 12px/1 ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;letter-spacing:.06em;
  color:var(--dk-text);text-shadow:none;opacity:.85}
.dk-label--gate.is-on{color:var(--dk-on-accent)}
.dk-label.is-highlight{color:var(--dk-highlight)}
.dk-value{font:600 26px/1 ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;color:var(--dk-text);
  font-variant-numeric:tabular-nums;transition:color .2s}
.dk-value.is-on{color:var(--dk-on-accent)}
.dk-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;padding:18px 22px;pointer-events:none}
.dk-title{font-size:15px;font-weight:600;letter-spacing:-.005em}
.dk-title small{display:block;font-size:12px;font-weight:500;color:var(--dk-muted);margin-top:2px}
.dk-controls{display:flex;gap:8px;pointer-events:auto;flex-wrap:wrap;justify-content:flex-end}
.dk-ctl{display:flex;align-items:center;gap:10px;height:34px;padding:0 12px;border-radius:10px;
  background:var(--dk-panel);border:1px solid var(--dk-line);color:var(--dk-text);font:inherit;font-size:13px}
button.dk-ctl{cursor:pointer;transition:border-color .15s,transform .1s}
button.dk-ctl:hover{border-color:var(--dk-muted)}
button.dk-ctl:active{transform:scale(.97)}
.dk-switch{width:28px;height:16px;border-radius:8px;background:var(--dk-line);position:relative;transition:background .2s}
.dk-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;
  background:var(--dk-text);transition:transform .2s cubic-bezier(.16,1,.3,1)}
[aria-checked=true] .dk-switch{background:var(--dk-accent)}
[aria-checked=true] .dk-switch::after{transform:translateX(12px);background:var(--dk-on-accent)}
.dk-ctl input[type=range]{width:110px;accent-color:var(--dk-accent)}
.dk-ctl output{font:500 12px ui-monospace,Menlo,monospace;color:var(--dk-muted);min-width:2.5em;text-align:right}
.dk-bar{position:absolute;left:0;right:0;bottom:0;padding:0 22px 16px}
.dk-caption{display:flex;align-items:center;gap:14px;margin:0 0 12px;min-height:38px}
.dk-count{font:600 12px ui-monospace,Menlo,monospace;color:var(--dk-accent);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.dk-text{flex:1;min-width:0;font-size:20px;font-weight:560;letter-spacing:-.01em;margin:0;text-shadow:0 0 8px var(--dk-canvas);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dk-text.is-new{animation:dk-rise .42s cubic-bezier(.16,1,.3,1)}
@keyframes dk-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.dk-transport{display:flex;align-items:center;gap:6px;height:46px;padding:0 8px 0 6px;border-radius:14px;
  background:var(--dk-panel);border:1px solid var(--dk-line)}
.dk-btn{width:34px;height:34px;border-radius:9px;border:0;background:transparent;color:var(--dk-text);
  display:grid;place-items:center;cursor:pointer;transition:background .15s,transform .1s}
.dk-btn:hover{background:var(--dk-raised)}
.dk-btn:active{transform:scale(.94)}
.dk-btn:disabled{opacity:.35;cursor:default;background:transparent}
.dk-btn svg{width:16px;height:16px;fill:currentColor}
.dk-btn--play{background:var(--dk-accent);color:var(--dk-on-accent)}
.dk-btn--play:hover{background:var(--dk-accent);filter:brightness(1.08)}
.dk-track{position:relative;flex:1;height:34px;margin:0 10px 0 12px}
.dk-rail,.dk-fill{position:absolute;left:0;top:50%;height:3px;margin-top:-1.5px;border-radius:2px}
.dk-rail{right:0;background:var(--dk-line)}
.dk-fill{background:var(--dk-accent);width:0}
.dk-tick{position:absolute;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;
  background:var(--dk-panel);border:2px solid var(--dk-line);transition:border-color .2s,background .2s,transform .25s cubic-bezier(.16,1,.3,1)}
.dk-tick.is-past{border-color:var(--dk-accent);background:var(--dk-accent)}
.dk-tick.is-current{border-color:var(--dk-accent);background:var(--dk-panel);transform:scale(1.45)}
.dk-tick.is-check{border-radius:3px;transform:rotate(45deg)}
.dk-tick.is-check.is-current{transform:rotate(45deg) scale(1.45)}
.dk-scrub{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.dk-check{display:flex;align-items:center;gap:12px;margin-left:auto;flex:none}
.dk-check[hidden]{display:none}
.dk-options{display:flex;flex-wrap:wrap;gap:8px}
.dk-opt{min-width:56px;height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--dk-line);
  background:var(--dk-raised);color:var(--dk-text);font:inherit;font-weight:560;cursor:pointer;transition:border-color .15s,background .15s}
.dk-opt:hover:not(:disabled){border-color:var(--dk-accent)}
.dk-opt:disabled{cursor:default}
.dk-opt.is-right{background:var(--dk-correct);border-color:var(--dk-correct);color:#fff}
.dk-opt.is-wrong{background:var(--dk-wrong);border-color:var(--dk-wrong);color:#fff}
.dk-feedback{font-size:14px;color:var(--dk-muted);display:flex;align-items:center;gap:12px;white-space:nowrap}
.dk-continue{background:var(--dk-accent);border-color:var(--dk-accent);color:var(--dk-on-accent);font-weight:560}
.dk-feedback[hidden]{display:none}
.dk-error{position:absolute;inset:0;display:grid;place-items:center;color:var(--dk-muted);font-size:15px}
:focus-visible{outline:2px solid var(--dk-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const ICONS = {
  prev: '<svg viewBox="0 0 16 16"><path d="M3 2.5h2v11H3zM13 2.8v10.4a.5.5 0 0 1-.78.42L5.8 8.42a.5.5 0 0 1 0-.84l6.42-5.2A.5.5 0 0 1 13 2.8z"/></svg>',
  next: '<svg viewBox="0 0 16 16"><path d="M11 2.5h2v11h-2zM3 2.8v10.4a.5.5 0 0 0 .78.42l6.42-5.2a.5.5 0 0 0 0-.84L3.78 2.38A.5.5 0 0 0 3 2.8z"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.6v10.8a.6.6 0 0 0 .9.52l9-5.4a.6.6 0 0 0 0-1.04l-9-5.4A.6.6 0 0 0 4 2.6z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function iconButton(className: string, label: string, icon: string, parent: HTMLElement): HTMLButtonElement {
  const button = el('button', `dk-btn ${className}`, parent);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = icon; // constant SVG markup, never spec text
  return button;
}

export interface ChromeHandlers {
  prev(): void;
  next(): void;
  togglePlay(): void;
  scrub(fraction: number): void;
  scrubEnd(fraction: number): void;
  control(bind: string, value: Scalar): void;
  answer(option: number): void;
}

export interface ChromeView {
  index: number;
  count: number;
  caption: string;
  /** Playhead 0..1 across the whole timeline. */
  progress: number;
  playing: boolean;
  checkpoint?: Checkpoint;
  /** Settled on the step (not mid-tween), so the checkpoint card may show. */
  settled: boolean;
  values: Record<string, Scalar | undefined>;
}

export class Chrome {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  private readonly count: HTMLElement;
  private readonly text: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly ticks: HTMLElement[] = [];
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly check: HTMLElement;
  private readonly options: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly feedbackText: HTMLElement;
  private readonly controlViews: Array<(values: ChromeView['values']) => void> = [];
  private shownCaption = '';
  private shownCheck: Checkpoint | undefined;
  private answered = false;
  private playing = false;

  constructor(
    host: HTMLElement,
    title: string,
    tickFractions: number[],
    checkSteps: boolean[],
    controls: DemoControl[],
    private readonly handlers: ChromeHandlers,
  ) {
    this.root = el('div', 'dk-root', host);
    this.stage = el('div', 'dk-stage', this.root);
    const top = el('header', 'dk-top', this.root);
    const titleEl = el('div', 'dk-title', top);
    titleEl.textContent = title;
    const ctlWrap = el('div', 'dk-controls', top);
    for (const control of controls.slice(0, 3)) this.buildControl(control, ctlWrap);

    const bar = el('footer', 'dk-bar', this.root);
    const caption = el('div', 'dk-caption', bar);
    this.count = el('span', 'dk-count', caption);
    this.text = el('p', 'dk-text', caption);
    this.text.setAttribute('aria-live', 'polite');
    // The checkpoint sits inline after the caption (which carries the question),
    // so it never covers the stage.
    this.check = el('section', 'dk-check', caption);
    this.check.hidden = true;
    this.check.setAttribute('aria-label', 'Checkpoint');
    this.options = el('div', 'dk-options', this.check);
    this.feedback = el('div', 'dk-feedback', this.check);
    this.feedback.hidden = true;
    this.feedback.setAttribute('aria-live', 'polite');
    this.feedbackText = el('span', '', this.feedback);
    const cont = el('button', 'dk-ctl dk-continue', this.feedback);
    cont.type = 'button';
    cont.textContent = 'Continue';
    cont.addEventListener('click', () => handlers.next());
    this.text.addEventListener('animationend', () => this.text.classList.remove('is-new'));
    const transport = el('div', 'dk-transport', bar);
    this.prevBtn = iconButton('', 'Previous step', ICONS.prev, transport);
    this.playBtn = iconButton('dk-btn--play', 'Play', ICONS.play, transport);
    this.nextBtn = iconButton('', 'Next step', ICONS.next, transport);
    this.prevBtn.addEventListener('click', () => handlers.prev());
    this.nextBtn.addEventListener('click', () => handlers.next());
    this.playBtn.addEventListener('click', () => handlers.togglePlay());

    const track = el('div', 'dk-track', transport);
    el('div', 'dk-rail', track);
    this.fill = el('div', 'dk-fill', track);
    tickFractions.forEach((fraction, i) => {
      const tick = el('span', `dk-tick${checkSteps[i] ? ' is-check' : ''}`, track);
      tick.style.left = `${fraction * 100}%`;
      this.ticks.push(tick);
    });
    this.scrubber = el('input', 'dk-scrub', track);
    this.scrubber.type = 'range';
    this.scrubber.min = '0';
    this.scrubber.max = '1000';
    this.scrubber.step = 'any';
    this.scrubber.setAttribute('aria-label', 'Scrub through the steps');
    const fraction = () => Number(this.scrubber.value) / 1000;
    this.scrubber.addEventListener('input', () => handlers.scrub(fraction()));
    this.scrubber.addEventListener('change', () => handlers.scrubEnd(fraction()));
    this.scrubber.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') handlers.prev();
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') handlers.next();
      else return;
      event.preventDefault();
    });
  }

  private buildControl(control: DemoControl, parent: HTMLElement): void {
    const name = control.label ?? control.bind.split('.')[0];
    if (control.type === 'toggle') {
      const button = el('button', 'dk-ctl', parent);
      button.type = 'button';
      button.setAttribute('role', 'switch');
      el('span', '', button).textContent = name;
      el('span', 'dk-switch', button);
      let on = false;
      button.addEventListener('click', () => this.handlers.control(control.bind, on ? 0 : 1));
      this.controlViews.push((values) => {
        on = truthy(values[control.bind]);
        button.setAttribute('aria-checked', String(on));
      });
      return;
    }
    const label = el('label', 'dk-ctl', parent);
    el('span', '', label).textContent = name;
    const input = el('input', '', label);
    input.type = 'range';
    input.min = String(control.min ?? 0);
    input.max = String(control.max ?? 1);
    input.step = String(control.step ?? 0.01);
    const out = el('output', '', label);
    input.addEventListener('input', () => {
      out.textContent = input.value;
      this.handlers.control(control.bind, Number(input.value));
    });
    this.controlViews.push((values) => {
      const v = values[control.bind];
      if (typeof v === 'number' && document.activeElement !== input) {
        input.value = String(v);
        out.textContent = String(v);
      }
    });
  }

  /** Puts each step tick at its label's share of the timeline. */
  placeTicks(fractions: number[]): void {
    this.ticks.forEach((tick, i) => (tick.style.left = `${(fractions[i] ?? 0) * 100}%`));
  }

  render(view: ChromeView, reducedMotion: boolean): void {
    this.count.textContent = `${view.index + 1} / ${view.count}`;
    if (view.caption !== this.shownCaption) {
      this.shownCaption = view.caption;
      this.text.textContent = view.caption;
      if (!reducedMotion) {
        this.text.classList.remove('is-new');
        void this.text.offsetWidth;
        this.text.classList.add('is-new');
      }
    }
    this.fill.style.width = `${view.progress * 100}%`;
    if (document.activeElement !== this.scrubber) this.scrubber.value = String(view.progress * 1000);
    this.scrubber.setAttribute('aria-valuetext', `Step ${view.index + 1} of ${view.count}: ${view.caption}`);
    this.ticks.forEach((tick, i) => {
      tick.classList.toggle('is-past', i < view.index);
      tick.classList.toggle('is-current', i === view.index);
    });
    this.prevBtn.disabled = view.index === 0;
    this.nextBtn.disabled = view.index >= view.count - 1;
    if (view.playing !== this.playing) {
      this.playing = view.playing;
      this.playBtn.innerHTML = view.playing ? ICONS.pause : ICONS.play;
      this.playBtn.setAttribute('aria-label', view.playing ? 'Pause' : 'Play');
    }
    for (const update of this.controlViews) update(view.values);
    this.renderCheck(view.settled ? view.checkpoint : undefined);
  }

  private renderCheck(checkpoint: Checkpoint | undefined): void {
    if (checkpoint === this.shownCheck) return;
    this.shownCheck = checkpoint;
    this.answered = false;
    this.check.hidden = !checkpoint;
    this.feedback.hidden = true;
    this.options.replaceChildren();
    if (!checkpoint) return;
    checkpoint.options.forEach((option, i) => {
      const button = el('button', 'dk-opt', this.options);
      button.type = 'button';
      button.textContent = option;
      button.addEventListener('click', () => {
        if (this.answered) return;
        this.answered = true;
        const correct = i === checkpoint.answer;
        button.classList.add(correct ? 'is-right' : 'is-wrong');
        this.options.children[checkpoint.answer]?.classList.add('is-right');
        for (const b of this.options.children) (b as HTMLButtonElement).disabled = true;
        this.feedbackText.textContent = correct
          ? 'Correct.'
          : `Not quite: the answer is ${checkpoint.options[checkpoint.answer] ?? ''}.`;
        this.feedback.hidden = false;
        this.handlers.answer(i);
      });
    });
  }

  showError(message: string): void {
    el('div', 'dk-error', this.root).textContent = message;
  }
}
