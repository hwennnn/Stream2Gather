type Handlers = {
  onMove: (event: PointerEvent) => void;
  /** Commit is true when the pointer was let go, false when the drag was lost. */
  onEnd: (commit: boolean) => void;
};

const EVENTS = ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const;

/**
 * Follows one pointer until it lets go. It listens on the window because the
 * element that was pressed can be removed mid-drag, and takes its own events with
 * it. Returns a function that stops following without calling onEnd.
 */
export const followPointer = (pointerId: number, handlers: Handlers, target: EventTarget = window): (() => void) => {
  const stop = () => {
    for (const name of EVENTS) target.removeEventListener(name, listener);
  };
  const listener = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== pointerId) return;
    if (event.type === 'pointermove') {
      handlers.onMove(pointer);
      return;
    }
    stop();
    handlers.onEnd(event.type === 'pointerup');
  };
  for (const name of EVENTS) target.addEventListener(name, listener);
  return stop;
};
