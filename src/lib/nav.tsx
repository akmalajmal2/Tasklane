"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Router = { push: (href: string) => void };
type VT = Document & { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> } };

let settle: (() => void) | null = null;

/**
 * Navigate inside a View Transition. The "after" snapshot is taken once the new route has
 * actually rendered (NavSignal below resolves the promise when the pathname changes), so the
 * old page slides out and the new one slides in, instead of flashing through the loading state.
 * Returns false when transitions aren't available so the caller can let the plain <Link> run.
 */
export function navigateWithTransition(router: Router, href: string, kind: "page" | "tab" = "page", dir: "forward" | "back" = "forward"): boolean {
  const d = document as VT;
  if (!d.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const root = document.documentElement;
  root.dataset.vt = kind;
  root.dataset.dir = dir;
  d.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
        router.push(href);
        window.setTimeout(resolve, 2500); // never leave the page frozen if navigation stalls
      }),
  ).finished.catch(() => {}).finally(() => {
    delete root.dataset.vt;
    delete root.dataset.dir;
  });
  return true;
}

/** Mounted once in the app layout: tells a pending transition that the new route is on screen. */
export function NavSignal() {
  const path = usePathname();
  useEffect(() => {
    // Wait one frame so the new route's DOM is painted-ready before the "after" snapshot.
    const id = requestAnimationFrame(() => {
      settle?.();
      settle = null;
    });
    return () => cancelAnimationFrame(id);
  }, [path]);
  return null;
}
