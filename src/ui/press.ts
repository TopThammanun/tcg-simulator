// Pointer handling for cards: a press becomes a drag after a few pixels, or a long press (touch) shows
// the card. Works the same for mouse, pen and touch; a plain tap is left to the element's click handler.

export interface PressHandlers {
  /** Whether moving the pointer should start a drag (false: only a long press is tracked). */
  canDrag: boolean;
  onDragStart?: (x: number, y: number) => void;
  onDragMove?: (x: number, y: number) => void;
  onDrop?: (x: number, y: number) => void;
  onCancel?: () => void;
  onLongPress?: () => void;
}

const DRAG_PX = 8;
const LONG_PRESS_MS = 450;

export function trackPress(e: PointerEvent, h: PressHandlers): void {
  if (e.button !== 0 || !e.isPrimary) return;
  const id = e.pointerId;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;
  const timer =
    h.onLongPress && e.pointerType !== 'mouse'
      ? setTimeout(() => {
          stop();
          swallowClick();
          h.onLongPress!();
        }, LONG_PRESS_MS)
      : undefined;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!dragging) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return;
      clearTimeout(timer);
      if (!h.canDrag) return stop();
      dragging = true;
      h.onDragStart?.(ev.clientX, ev.clientY);
    }
    ev.preventDefault();
    h.onDragMove?.(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    stop();
    if (dragging) {
      swallowClick();
      h.onDrop?.(ev.clientX, ev.clientY);
    }
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    stop();
    if (dragging) h.onCancel?.();
  };
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** The click that follows a drag or a long press must not also select the card. */
function swallowClick() {
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 120);
}
