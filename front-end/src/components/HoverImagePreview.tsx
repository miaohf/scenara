import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface HoverImagePreviewProps {
  src?: string;
  alt?: string;
  children: React.ReactNode;
  delayMs?: number;
  maxSize?: number;
  className?: string;
}

const VIEWPORT_PAD = 10;
const GAP = 12;

const computePosition = (
  anchor: DOMRect,
  width: number,
  height: number,
): { left: number; top: number } => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.right + GAP;
  if (left + width > vw - VIEWPORT_PAD) {
    left = anchor.left - GAP - width;
  }
  if (left < VIEWPORT_PAD) {
    left = Math.min(Math.max(VIEWPORT_PAD, anchor.left), vw - width - VIEWPORT_PAD);
  }

  let top = anchor.top + anchor.height / 2 - height / 2;
  if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
  if (top + height > vh - VIEWPORT_PAD) {
    top = Math.max(VIEWPORT_PAD, vh - height - VIEWPORT_PAD);
  }

  return { left, top };
};

const HoverImagePreview: React.FC<HoverImagePreviewProps> = ({
  src,
  alt,
  children,
  delayMs = 280,
  maxSize = 320,
  className = '',
}) => {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const clearShowTimer = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const hide = useCallback(() => {
    clearShowTimer();
    setVisible(false);
  }, []);

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(computePosition(rect, maxSize, maxSize));
  }, [maxSize]);

  const show = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const handleMouseEnter = () => {
    if (!src) return;
    clearShowTimer();
    showTimerRef.current = window.setTimeout(show, delayMs);
  };

  useEffect(() => () => clearShowTimer(), []);

  useEffect(() => {
    if (!visible) return;

    const handleReposition = () => updatePosition();
    const handleDismiss = () => hide();

    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleReposition);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, hide, updatePosition]);

  if (!src) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={`inline-flex shrink-0 ${className}`.trim()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={hide}
        aria-describedby={visible ? tooltipId : undefined}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            role="tooltip"
            id={tooltipId}
            className="pointer-events-none fixed z-[80] overflow-hidden rounded-xl border border-[var(--overlay-border)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            style={{
              left: position.left,
              top: position.top,
              width: maxSize,
              height: maxSize,
            }}
          >
            <img
              src={src}
              alt={alt || '预览'}
              className="h-full w-full rounded-lg object-contain bg-[var(--bg-base)]"
            />
            {alt && (
              <div className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-[var(--overlay-medium)] px-2 py-1 backdrop-blur-sm">
                <p className="truncate text-center text-[10px] text-[var(--text-primary)]">{alt}</p>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default HoverImagePreview;
