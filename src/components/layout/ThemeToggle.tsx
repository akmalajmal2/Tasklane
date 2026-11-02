"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/common/ui";

type Theme = "system" | "light" | "dark";
const KEY = "tl-theme";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };
const ICON: Record<Theme, string> = { system: "monitor", light: "sun", dark: "moon" };

function apply(t: Theme, fade = true) {
  const root = document.documentElement;
  // Short-lived class so colours cross-fade instead of snapping (see .theme-switching in globals.css).
  if (fade) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 400);
  }
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = dark ? "#1d2125" : "#ffffff";
  });
}

/** Cycles System → Light → Dark. The choice is stored in localStorage; a tiny inline script in <head> applies it before first paint. */
export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = document.documentElement.getAttribute("data-theme");
    setTheme(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  const cycle = () => {
    const next = NEXT[theme];
    const root = document.documentElement;
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition?.bind(document);
    if (vt && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.dataset.vt = "theme";
      vt(() => {
        flushSync(() => setTheme(next));
        apply(next, false);
      }).finished.catch(() => {}).finally(() => delete root.dataset.vt);
    } else {
      setTheme(next);
      apply(next);
    }
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just won't persist */
    }
  };

  return (
    <button
      type="button"
      className={`icon-btn theme-btn${floating ? " floating" : ""}`}
      onClick={cycle}
      aria-label={`${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]].toLowerCase()}`}
      title={LABEL[theme]}
    >
      <span key={theme} className="theme-ico">
        <Icon n={ICON[theme]} size={18} />
      </span>
    </button>
  );
}
