import { flushSync } from "react-dom";

type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
type VT = Document & { startViewTransition?: (cb: () => void) => Transition };

/**
 * Run a state update inside a View Transition so cards glide to their new place
 * instead of jumping. Falls back to a plain update when the browser has no
 * support or the person prefers reduced motion.
 */
export function withTransition(update: () => void) {
  const d = typeof document === "undefined" ? undefined : (document as VT);
  if (!d?.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  const t = d.startViewTransition(() => flushSync(update));
  // A hidden tab aborts the transition. The state update still ran: this only silences the rejection.
  t?.ready?.catch(() => {});
  t?.finished?.catch(() => {});
  t?.updateCallbackDone?.catch(() => {});
}
