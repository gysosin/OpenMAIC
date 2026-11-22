'use client';

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, useMotionValue } from 'motion/react';
import { Captions, GripHorizontal } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { boxToCaptionPos, type CaptionFloatPos, type CaptionMode } from '@/lib/caption-mode';
import type { PresentationBubbleModel } from '@/components/roundtable/presentation-speech-overlay';

/** Button that steps to the next caption mode, so the mode is reachable without the keyboard. */
function ModeButton({ mode, onCycle }: { mode: CaptionMode; onCycle: () => void }) {
  const { t } = useI18n();
  const label = t('roundtable.captionCycle', { mode: t(`roundtable.captionMode.${mode}`) });
  return (
    <button
      type="button"
      onClick={onCycle}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <Captions className="h-4 w-4" />
    </button>
  );
}

/**
 * Reserved strip under the stage: the stage shrinks to make room, so the slide is never
 * covered. The height is fixed, so a long caption scrolls inside it instead of growing.
 */
export function CaptionBand({
  bubble,
  onCycle,
}: {
  readonly bubble: PresentationBubbleModel | null;
  readonly onCycle: () => void;
}) {
  return (
    <div
      data-testid="caption"
      data-mode="band"
      className="pointer-events-auto absolute inset-x-0 top-0 flex h-12 items-center gap-3 border-t border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900"
    >
      {bubble && (
        <>
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-gray-200 dark:border-gray-700">
            <AvatarDisplay src={bubble.avatar} alt={bubble.name} />
          </div>
          <div
            data-testid="caption-text"
            className="max-h-10 min-w-0 flex-1 overflow-y-auto text-sm leading-snug text-gray-800 scrollbar-hide dark:text-gray-100"
          >
            <span className="mr-2 font-medium text-gray-500 dark:text-gray-400">{bubble.name}</span>
            {bubble.text}
          </div>
        </>
      )}
      {!bubble && <div className="flex-1" />}
      <ModeButton mode="band" onCycle={onCycle} />
    </div>
  );
}

/**
 * Draggable bubble (float) or chip (pill), portalled into the stage and kept inside it.
 * The position is a 0..1 fraction of the stage's free space, so it fits any stage size:
 * `left: x%` with `translateX(-x%)` puts the left edge at x * (stage - bubble).
 */
export function FloatingCaption({
  mode,
  stage,
  pos,
  onMove,
  onCycle,
  children,
}: {
  readonly mode: 'float' | 'pill';
  readonly stage: HTMLElement;
  readonly pos: CaptionFloatPos;
  readonly onMove: (pos: CaptionFloatPos) => void;
  readonly onCycle: () => void;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const region = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);

  return createPortal(
    <div ref={region} className="pointer-events-none absolute inset-3 z-30 @container">
      <div
        className="absolute"
        style={{
          left: `${pos.x * 100}%`,
          top: `${pos.y * 100}%`,
          transform: `translate(${-pos.x * 100}%, ${-pos.y * 100}%)`,
        }}
      >
        <motion.div
          ref={bubble}
          data-testid="caption"
          data-mode={mode}
          drag
          dragControls={controls}
          dragListener={false}
          dragConstraints={region}
          dragElastic={0}
          dragMomentum={false}
          style={{ x: dx, y: dy }}
          onDragEnd={() => {
            const b = bubble.current!.getBoundingClientRect();
            const r = region.current!.getBoundingClientRect();
            onMove(boxToCaptionPos(b, r));
            dx.set(0);
            dy.set(0);
          }}
          className="pointer-events-auto"
        >
          <div className="flex items-center justify-between">
            <div
              data-testid="caption-drag-handle"
              role="button"
              aria-label={t('roundtable.captionMove')}
              title={t('roundtable.captionMove')}
              onPointerDown={(e) => controls.start(e)}
              className="flex h-5 flex-1 cursor-grab touch-none items-center justify-center rounded-t-lg bg-gray-100 text-gray-400 active:cursor-grabbing dark:bg-gray-800 dark:text-gray-500"
            >
              <GripHorizontal className="h-3.5 w-3.5" />
            </div>
            <button
              type="button"
              onClick={onCycle}
              aria-label={t('roundtable.captionCycle', {
                mode: t(`roundtable.captionMode.${mode}`),
              })}
              className="h-5 rounded-t-lg bg-gray-100 px-1.5 text-gray-400 hover:text-gray-700 dark:bg-gray-800 dark:hover:text-gray-200"
            >
              <Captions className="h-3.5 w-3.5" />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    </div>,
    stage,
  );
}
