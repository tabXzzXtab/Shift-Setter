/**
 * What the tour waits for: a real action that SUCCEEDED.
 *
 * A step that says "press Skapa" advances when the passes exist, not when the
 * button was pressed -- a refused submit (an overlap, a missing field, no
 * network) has to leave the person on the step that explains it.
 *
 * A window event rather than a context call, so the screens that raise these
 * do not depend on the tour at all: with no tour running, nobody is listening
 * and a signal costs one dispatch.
 */
export type TourSignal =
  | "project-created"
  | "passes-created"
  | "day-confirmed"
  | "availability-saved"
  | "offer-accepted"
  | "stamped-in"
  | "arbetsdagbok-generated";

const EVENT = "byggkoll:tour-signal";

export function tourSignal(signal: TourSignal) {
  try {
    window.dispatchEvent(new CustomEvent<TourSignal>(EVENT, { detail: signal }));
  } catch { /* no window during prerender */ }
}

export function onTourSignal(handler: (signal: TourSignal) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<TourSignal>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
