"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { initials } from "@/lib/format";

const PATHS: Record<string, string> = {
  bell: "M6 9a6 6 0 1112 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 20a2 2 0 004 0",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  clock: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3",
  users: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M16 4.2a3.5 3.5 0 010 6.6",
  board: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  sun: "M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
  inbox: "M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5",
  gavel: "M14 4l6 6M11 7l6 6M4 20l7-7M9 5l6 6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  timer: "M9 2h6M12 8v5l3 2M12 21a8 8 0 100-16 8 8 0 000 16z",
  paperclip: "M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  chevron: "M9 6l6 6-6 6",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0",
  archive: "M4 5h16v4H4zM6 9v10h12V9M10 13h4",
  comment: "M4 5h16v11H10l-4 4v-4H4z",
  shuffle: "M16 4h4v4M4 20L20 4M20 16v4h-4M15 15l5 5M4 4l5 5",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  pause: "M8 5v14M16 5v14",
};

export function Icon({ n, size = 16 }: { n: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[n]} />
    </svg>
  );
}

export function Avatar({ name, size = 24, src }: { name: string; size?: number; src?: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" src={src} alt="" title={name} style={{ width: size, height: size, objectFit: "cover" }} />;
  }
  let h = 7;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${Math.abs(h) % 360} 48% 38%)` }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Native <dialog>: focus trap, Esc, top-layer and backdrop come from the browser.
 * Content is re-mounted on every open so forms start clean, and kept while the
 * closing animation plays.
 */
export function Modal({
  open,
  onClose,
  label,
  variant = "modal",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  variant?: "modal" | "drawer" | "alert";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const last = useRef<ReactNode>(null);
  const [gen, setGen] = useState(0);
  if (open) last.current = children;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setGen((g) => g + 1);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={variant}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <Fragment key={gen}>{last.current}</Fragment>
    </dialog>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Working" />;
}
