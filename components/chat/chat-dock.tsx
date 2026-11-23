'use client';

/**
 * The classroom's agent dock, as the foot of the side panel's Chat tab: who is in the room,
 * what they are doing, and how the learner speaks (mic, text, suggested replies).
 *
 * Presentational only. `Roundtable` owns the state (recorder, draft, send cooldown) and
 * portals this into the host `ChatArea` provides, so the transport bar stays the only bar
 * under the stage.
 */
import type { ReactNode, RefObject } from 'react';
import { motion } from 'motion/react';
import { Loader2, MessageSquare, Mic, MicOff, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import type { Participant } from '@/lib/types/roundtable';

const VOICE_WAVE_BARS = [
  { peak: 18, duration: 0.55 },
  { peak: 24, duration: 0.72 },
  { peak: 15, duration: 0.63 },
  { peak: 22, duration: 0.68 },
  { peak: 27, duration: 0.78 },
  { peak: 19, duration: 0.61 },
  { peak: 26, duration: 0.74 },
  { peak: 17, duration: 0.58 },
  { peak: 23, duration: 0.7 },
  { peak: 16, duration: 0.57 },
  { peak: 21, duration: 0.66 },
  { peak: 14, duration: 0.53 },
] as const;

export function VoiceWaveformBars({ barClassName }: { readonly barClassName: string }) {
  return VOICE_WAVE_BARS.map((bar, i) => (
    <motion.div
      key={i}
      animate={{
        height: [4, bar.peak, 4],
        opacity: [0.3, 1, 0.3],
      }}
      transition={{
        repeat: Infinity,
        duration: bar.duration,
        delay: i * 0.05,
        ease: 'easeInOut',
      }}
      className={cn('w-1 rounded-full', barClassName)}
    />
  ));
}

export interface ChatDockProps {
  /** Teacher and student agents; the learner is `userAvatar`. */
  readonly participants: Participant[];
  readonly userAvatar: string;
  readonly activeRole: 'teacher' | 'user' | 'agent' | null;
  readonly speakingAgentId?: string | null;
  /** The agent whose avatar a discussion invitation points at. */
  readonly anchorAgentId?: string | null;
  readonly anchorRef: RefObject<HTMLDivElement | null>;
  readonly isThinking: boolean;
  readonly isCueUser: boolean;
  readonly asrEnabled: boolean;
  readonly isInputOpen: boolean;
  readonly isVoiceOpen: boolean;
  readonly isRecording: boolean;
  readonly isProcessing: boolean;
  readonly isSendCooldown: boolean;
  readonly inputValue: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly quickReplies: string[];
  readonly referencePill?: ReactNode;
  readonly onInputChange: (value: string) => void;
  readonly onUserInputActivity?: (kind: 'text_input' | 'composition_start') => void;
  readonly onSend: () => void;
  readonly onQuickReply: (label: string) => void;
  readonly onToggleInput: () => void;
  readonly onToggleVoice: () => void;
}

function Avatar({
  participant,
  active,
  anchorRef,
}: {
  readonly participant: Participant;
  readonly active: boolean;
  readonly anchorRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={anchorRef}
      title={participant.name}
      className={cn(
        'size-8 shrink-0 overflow-hidden rounded-full bg-muted ring-offset-2 ring-offset-surface transition-opacity',
        active ? 'ring-2 ring-primary' : 'opacity-70 ring-1 ring-border hover:opacity-100',
      )}
    >
      <AvatarDisplay src={participant.avatar} alt={participant.name} />
    </div>
  );
}

export function ChatDock({
  participants,
  userAvatar,
  activeRole,
  speakingAgentId,
  anchorAgentId,
  anchorRef,
  isThinking,
  isCueUser,
  asrEnabled,
  isInputOpen,
  isVoiceOpen,
  isRecording,
  isProcessing,
  isSendCooldown,
  inputValue,
  inputRef,
  quickReplies,
  referencePill,
  onInputChange,
  onUserInputActivity,
  onSend,
  onQuickReply,
  onToggleInput,
  onToggleVoice,
}: ChatDockProps) {
  const { t } = useI18n();
  const youActive = activeRole === 'user' || isInputOpen;
  const status = isVoiceOpen
    ? isProcessing
      ? t('roundtable.processing')
      : t('roundtable.listening')
    : isThinking
      ? t('roundtable.thinking')
      : null;

  return (
    <div
      data-testid="chat-dock"
      className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto p-1 scrollbar-hide">
          {participants.map((p) => {
            const active =
              p.role === 'teacher' ? activeRole === 'teacher' : speakingAgentId === p.id;
            return (
              <Avatar
                key={p.id}
                participant={p}
                active={active}
                anchorRef={p.id === anchorAgentId ? anchorRef : undefined}
              />
            );
          })}
        </div>
        {isVoiceOpen && (
          <div className="flex h-8 items-center gap-0.5" aria-hidden>
            <VoiceWaveformBars barClassName="bg-primary" />
          </div>
        )}
        {status && (
          <span role="status" className="truncate text-xs text-muted-foreground">
            {status}
          </span>
        )}
        <button
          type="button"
          aria-label={t('roundtable.you')}
          title={t('roundtable.you')}
          onClick={onToggleInput}
          className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div
            className={cn(
              'size-8 overflow-hidden rounded-full bg-muted ring-offset-2 ring-offset-surface transition-opacity',
              youActive ? 'ring-2 ring-primary' : 'opacity-70 ring-1 ring-border hover:opacity-100',
              isCueUser && 'ring-2 ring-warning',
            )}
          >
            <AvatarDisplay src={userAvatar} alt={t('roundtable.you')} />
          </div>
        </button>
      </div>

      {referencePill && <div className="[&>div]:max-w-full">{referencePill}</div>}

      {isCueUser && !isThinking && !isInputOpen && !isVoiceOpen && (
        <button
          type="button"
          data-testid="cue-user-panel"
          onClick={() => (asrEnabled ? onToggleVoice() : onToggleInput())}
          className="flex h-8 items-center justify-center gap-2 rounded-md border border-warning-border bg-warning-surface text-sm font-medium text-warning-text transition-colors hover:bg-accent"
        >
          {asrEnabled ? <Mic className="size-4" /> : <MessageSquare className="size-4" />}
          {t('roundtable.yourTurn')}
        </button>
      )}

      {quickReplies.length > 0 && isCueUser && !isThinking && !isInputOpen && !isVoiceOpen && (
        <div data-testid="cue-user-suggested-bubble">
          <div
            data-testid="cue-user-options"
            role="group"
            aria-label={t('roundtable.yourTurn')}
            className="flex max-h-24 flex-wrap gap-2 overflow-y-auto"
          >
            {quickReplies.map((label, index) => (
              <button
                key={`${index}-${label}`}
                type="button"
                title={label}
                aria-label={label}
                disabled={isSendCooldown}
                onClick={() => onQuickReply(label)}
                className="h-8 max-w-full truncate rounded-md border border-border-strong bg-surface px-3 text-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div data-testid="roundtable-non-presentation-card" className="overflow-hidden">
        <div className="flex items-end gap-2 p-0.5">
          <Button
            type="button"
            variant={isVoiceOpen ? 'default' : 'ghost'}
            size="icon-sm"
            aria-label={
              isVoiceOpen
                ? isRecording
                  ? t('roundtable.stopRecording')
                  : t('roundtable.startRecording')
                : asrEnabled
                  ? t('roundtable.voiceInput')
                  : t('roundtable.voiceInputDisabled')
            }
            title={asrEnabled ? t('roundtable.voiceInput') : t('roundtable.voiceInputDisabled')}
            disabled={!asrEnabled || (isSendCooldown && !isVoiceOpen)}
            onClick={onToggleVoice}
            className={cn(!isVoiceOpen && 'text-muted-foreground hover:text-foreground')}
          >
            {asrEnabled ? <Mic /> : <MicOff />}
          </Button>
          {isInputOpen ? (
            <div data-testid="roundtable-non-presentation-input-stage" className="min-w-0 flex-1">
              <div
                data-testid="roundtable-non-presentation-input-panel"
                className="flex items-end gap-1 rounded-md border border-border-strong bg-background py-1 pl-3 pr-1 focus-within:ring-2 focus-within:ring-ring"
              >
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => onInputChange(e.target.value)}
                  onBeforeInput={() => onUserInputActivity?.('text_input')}
                  onCompositionStart={() => onUserInputActivity?.('composition_start')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      onSend();
                    }
                  }}
                  placeholder={t('roundtable.inputPlaceholder')}
                  autoFocus
                  rows={1}
                  className="min-h-8 max-h-[100px] w-full resize-none overflow-y-auto bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label={t('roundtable.send')}
                  disabled={isSendCooldown}
                  onClick={onSend}
                >
                  {isSendCooldown ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-label={t('roundtable.textInput')}
              disabled={isSendCooldown}
              onClick={onToggleInput}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {isSendCooldown ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <MessageSquare className="size-4 shrink-0" />
              )}
              <span className="truncate">{t('roundtable.inputPlaceholder')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
