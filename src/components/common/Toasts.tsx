"use client";

import Link from "next/link";
import { useApp } from "@/store/app-store";

/** Each toast fades out with a CSS animation and removes itself when that animation ends. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} onAnimationEnd={(e) => e.animationName === "toast-life" && dismiss(t.id)}>
          <span>{t.text}</span>
          {t.href && (
            <Link href={t.href} onClick={() => dismiss(t.id)}>
              View
            </Link>
          )}
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
