// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Roundtable } from '@/components/roundtable';
import { computePlaybackView } from '@/lib/playback/derived-state';

vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/hooks/use-audio-recorder', () => ({
  useAudioRecorder: () => ({
    isRecording: false,
    isProcessing: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
  }),
}));
vi.mock('@/lib/model-settings/use-model-settings', () => ({ useModelCapabilities: () => ({}) }));
vi.mock('@/lib/hooks/use-asr-available', () => ({ useASRAvailable: () => false }));
vi.mock('@/components/ui/avatar-display', () => ({ AvatarDisplay: () => null }));

const view = computePlaybackView({
  engineMode: 'idle',
  lectureSpeech: 'Old lecture',
  liveSpeech: null,
  speakingAgentId: null,
  thinkingState: null,
  isCueUser: true,
  isTopicPending: false,
  chatIsStreaming: false,
  discussionTrigger: null,
  playbackCompleted: false,
  idleText: 'Old intro',
  speakingStudent: false,
  sessionType: 'qa',
});

describe('Roundtable suggested replies', () => {
  let container: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    // The side panel's Chat tab foot, where the dock renders in normal playback.
    host = document.createElement('div');
    document.body.append(container, host);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    host.remove();
    vi.unstubAllGlobals();
  });
  const render = async (extra: Partial<ComponentProps<typeof Roundtable>> = {}) => {
    await act(async () =>
      root.render(
        createElement(Roundtable, {
          playbackView: view,
          isCueUser: true,
          sessionType: 'qa',
          isStreaming: false,
          controlsVisible: true,
          dockHost: host,
          ...extra,
        }),
      ),
    );
  };
  /** Where the controls are: the window in full-screen, the side panel otherwise. */
  const controls = (isPresenting: boolean) => (isPresenting ? container : host);
  const cueButton = (isPresenting: boolean) => {
    const panel = controls(isPresenting).querySelector('[data-testid="cue-user-panel"]')!;
    return (
      panel.tagName === 'BUTTON' ? panel : panel.querySelector('button')
    ) as HTMLButtonElement;
  };

  it.each([
    { isPresenting: false, cueUserOptions: undefined },
    { isPresenting: true, cueUserOptions: undefined },
    { isPresenting: false, cueUserOptions: [] },
    { isPresenting: true, cueUserOptions: [] },
    { isPresenting: false, cueUserOptions: ['', '   '] },
    { isPresenting: true, cueUserOptions: ['', '   '] },
  ])(
    'keeps main idle cue without bubbles when options are empty ($isPresenting, $cueUserOptions)',
    async (extra) => {
      await render(extra);
      expect(document.body.querySelector('[data-bubble-role]')).toBeNull();
      expect(document.body.querySelector('[data-testid="cue-user-options"]')).toBeNull();
      expect(controls(extra.isPresenting).textContent).toContain('roundtable.yourTurn');
      expect(document.body.textContent).not.toContain('Old lecture');
    },
  );

  it.each([false, true])(
    'shows full-label ordinary replies with hover text and deduplicates immediate clicks (fullscreen=%s)',
    async (isPresenting) => {
      const onMessageSend = vi.fn();
      const onStopDiscussion = vi.fn();
      const label = 'Back to the lesson and keep this as an ordinary user message';
      await render({
        isPresenting,
        cueUserOptions: ['Show an example', label],
        onMessageSend,
        onStopDiscussion,
      });
      const replies = controls(isPresenting).querySelector('[data-testid="cue-user-options"]');
      expect(replies).not.toBeNull();
      expect(replies?.querySelectorAll('button')).toHaveLength(2);
      const button = replies!.querySelectorAll('button')[1] as HTMLButtonElement;
      expect(button.title).toBe(label);
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.textContent).toBe(label);
      act(() => {
        button.click();
        button.click();
      });
      expect(onMessageSend).toHaveBeenCalledExactlyOnceWith(label);
      expect(onStopDiscussion).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'does not consume a reply rejected by the ordinary send guard (fullscreen=%s)',
    async (isPresenting) => {
      const canSendMessage = vi.fn(() => false);
      const onMessageSend = vi.fn();
      const label = 'Show an example';
      await render({
        isPresenting,
        cueUserOptions: [label, 'Keep going'],
        canSendMessage,
        onMessageSend,
      });
      const button = controls(isPresenting).querySelector(
        '[data-testid="cue-user-options"] button',
      ) as HTMLButtonElement;
      act(() => button.click());
      expect(onMessageSend).not.toHaveBeenCalled();
      expect(button.disabled).toBe(false);
      canSendMessage.mockReturnValue(true);
      act(() => button.click());
      expect(onMessageSend).toHaveBeenCalledExactlyOnceWith(label);
    },
  );

  it.each([false, true])(
    'keeps manual input available while offering replies (fullscreen=%s)',
    async (isPresenting) => {
      await render({ isPresenting, cueUserOptions: ['Show an example', 'Keep going'] });
      act(() => cueButton(isPresenting).click());
      expect(controls(isPresenting).querySelector('textarea')).not.toBeNull();
    },
  );

  it.each([false, true])(
    'does not show stale options after the cue ends (fullscreen=%s)',
    async (isPresenting) => {
      await render({
        isPresenting,
        isCueUser: false,
        cueUserOptions: ['Show an example', 'Keep going'],
      });
      expect(document.body.querySelector('[data-testid="cue-user-options"]')).toBeNull();
    },
  );

  it.each([false, true])(
    'renders replies as a suggested user bubble, not inside the centered cue (fullscreen=%s)',
    async (isPresenting) => {
      await render({ isPresenting, cueUserOptions: ['Show an example', 'Keep going'] });
      const where = controls(isPresenting);
      const bubble = where.querySelector('[data-testid="cue-user-suggested-bubble"]');
      const replies = where.querySelector('[data-testid="cue-user-options"]');
      expect(bubble).not.toBeNull();
      expect(bubble?.contains(replies)).toBe(true);
      expect(
        where.querySelector('[data-testid="cue-user-panel"] [data-testid="cue-user-options"]'),
      ).toBeNull();
      if (isPresenting) {
        // Outlined "you could say" variant, never the filled "you said" bubble.
        const surface = bubble!.firstElementChild!.classList;
        expect(surface.contains('border-dashed')).toBe(true);
        expect(surface.contains('rounded-br-sm')).toBe(true);
        expect(surface.contains('bg-purple-600/95')).toBe(false);
      }
    },
  );

  it.each([false, true])(
    'hides the suggested bubble while the text input is open (fullscreen=%s)',
    async (isPresenting) => {
      await render({ isPresenting, cueUserOptions: ['Show an example', 'Keep going'] });
      act(() => cueButton(isPresenting).click());
      expect(controls(isPresenting).querySelector('textarea')).not.toBeNull();
      await vi.waitFor(() =>
        expect(
          controls(isPresenting).querySelector('[data-testid="cue-user-suggested-bubble"]'),
        ).toBeNull(),
      );
    },
  );

  it.each([false, true])(
    'wraps four long replies in one bounded, vertically scrolling region (fullscreen=%s)',
    async (isPresenting) => {
      const options = ['a', 'b', 'c', 'd'].map((label) => label.repeat(60));
      await render({ isPresenting, cueUserOptions: options });
      const regions = document.body.querySelectorAll('[data-testid="cue-user-options"]');
      expect(regions).toHaveLength(1);
      const replies = regions[0];
      expect(replies?.querySelectorAll('button')).toHaveLength(4);
      const classes = replies?.getAttribute('class') ?? '';
      expect(classes).toContain('flex-wrap');
      expect(classes).toContain('overflow-y-auto');
      expect(classes).toMatch(/max-h-/);
      for (const button of replies!.querySelectorAll('button')) {
        expect(button.getAttribute('class')).toContain('truncate');
      }
      expect(document.body.querySelector('[data-bubble-role]')).toBeNull();
    },
  );

  describe('in normal playback', () => {
    const layer = () => container.querySelector('[data-testid="roundtable-speech-layer"]');
    const lecture = computePlaybackView({
      engineMode: 'playing',
      lectureSpeech: 'The lecture goes on',
      liveSpeech: null,
      speakingAgentId: null,
      thinkingState: null,
      isCueUser: false,
      isTopicPending: false,
      chatIsStreaming: false,
      discussionTrigger: null,
      playbackCompleted: false,
      idleText: null,
      speakingStudent: false,
      sessionType: null,
    });
    const plain = (extra: Partial<ComponentProps<typeof Roundtable>> = {}) =>
      render({ playbackView: lecture, isCueUser: false, sessionType: undefined, ...extra });

    it('puts the speech over the stage and leaves one bar, the transport bar, under it', async () => {
      await plain();
      const region = container.querySelector('[data-testid="roundtable-region"]');
      expect(region).not.toBeNull();
      expect(layer()).not.toBeNull();
      expect(region?.contains(layer())).toBe(false);
      expect(layer()?.querySelector('.fixed')).toBeNull();
      expect(layer()?.textContent).toContain('The lecture goes on');
      // No dock, no input, no mic under the stage.
      expect(container.querySelector('textarea')).toBeNull();
      expect(container.querySelector('[aria-label="roundtable.textInput"]')).toBeNull();
    });

    it('offers mic and text input from the side panel, with one input', async () => {
      await plain();
      expect(host.querySelector('[aria-label="roundtable.voiceInputDisabled"]')).not.toBeNull();
      const textInput = host.querySelector<HTMLButtonElement>(
        '[aria-label="roundtable.textInput"]',
      );
      await act(async () => textInput?.click());
      expect(document.body.querySelectorAll('textarea')).toHaveLength(1);
      expect(host.querySelector('textarea')).not.toBeNull();
    });

    it('asks for the Chat tab when an input opens, and renders nothing without a host', async () => {
      const onOpenChat = vi.fn();
      await plain({ dockHost: null, onOpenChat });
      expect(host.children).toHaveLength(0);
      expect(onOpenChat).not.toHaveBeenCalled();
      await plain({ dockHost: host, onOpenChat });
      const textInput = host.querySelector<HTMLButtonElement>(
        '[aria-label="roundtable.textInput"]',
      );
      await act(async () => textInput?.click());
      expect(onOpenChat).toHaveBeenCalled();
    });

    it('leaves the stage to the course end', async () => {
      await plain({ courseEndOpen: true });
      expect(layer()).toBeNull();
    });

    it('keeps full-screen pinned to the window, with the toolbar in the layer', async () => {
      await plain({ isPresenting: true });
      expect(container.querySelector('[data-testid="roundtable-region"]')).toBeNull();
      expect(layer()?.querySelector('.fixed')).not.toBeNull();
      expect(host.children).toHaveLength(0);
    });
  });
});
