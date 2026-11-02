"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/common/ui";

/* Dates are plain "yyyy-mm-dd" strings in the viewer's timezone, like <input type="date">. */
const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const long = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

const POP_W = 304;
const POP_H = 372; // six week rows always render, so the height never changes

const WEEK = Array.from({ length: 7 }, (_, i) => dayName.format(new Date(2024, 0, 1 + i))); // Mon..Sun

/** Month grid starting on Monday, always 6 rows. */
function grid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
}

export function DatePicker({
  name, defaultValue = "", min, label, placeholder = "Pick a date",
}: {
  name: string;
  defaultValue?: string;
  /** Earliest selectable day, "yyyy-mm-dd". */
  min?: string;
  label: string;
  placeholder?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(() => (defaultValue ? fromKey(defaultValue) : new Date()));
  const [focusTick, setFocusTick] = useState(0);

  const today = toKey(new Date());
  const view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const blocked = (d: Date) => !!min && toKey(d) < min;

  // Anchor the calendar under the field (or above it when there is no room). It sits in the top layer.
  const place = () => {
    const el = pop.current;
    const r = trigger.current?.getBoundingClientRect();
    if (!el || !r) return;
    const below = r.bottom + 6 + POP_H <= window.innerHeight || r.top - 6 - POP_H < 0;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8))}px`;
    el.style.top = `${below ? Math.min(r.bottom + 6, Math.max(8, window.innerHeight - POP_H - 8)) : r.top - 6 - POP_H}px`;
  };

  const pick = (d: Date) => {
    if (blocked(d)) return;
    setValue(toKey(d));
    setCursor(d);
    pop.current?.hidePopover();
    trigger.current?.focus();
  };

  // Focus the highlighted day whenever the calendar opens or the keyboard moves it.
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLButtonElement>('button[data-cursor="true"]')?.focus();
  }, [open, focusTick]);

  const move = (to: Date) => {
    setCursor(to);
    setFocusTick((n) => n + 1);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const delta = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? -7 : k === "ArrowDown" ? 7 : 0;
    if (delta) move(addDays(cursor, delta));
    else if (k === "Home") move(addDays(cursor, -((cursor.getDay() + 6) % 7)));
    else if (k === "End") move(addDays(cursor, 6 - ((cursor.getDay() + 6) % 7)));
    else if (k === "PageUp") move(addMonths(cursor, e.shiftKey ? -12 : -1));
    else if (k === "PageDown") move(addMonths(cursor, e.shiftKey ? 12 : 1));
    else return;
    e.preventDefault();
  };

  const quick = [
    { label: "Today", d: new Date() },
    { label: "Tomorrow", d: addDays(new Date(), 1) },
    { label: "In a week", d: addDays(new Date(), 7) },
  ];

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <button
        ref={trigger}
        type="button"
        className="date-trigger"
        popoverTarget={id}
        aria-label={value ? `${label}: ${full.format(fromKey(value))}. Change date` : `${label}. Pick a date`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-empty={value ? undefined : "true"}
        onClick={() => {
          setCursor(value ? fromKey(value) : blocked(new Date()) ? fromKey(min!) : new Date());
          place();
        }}
      >
        <Icon n="calendar" size={16} />
        <span>{value ? long.format(fromKey(value)) : placeholder}</span>
        <Icon n="chevron" size={14} />
      </button>

      <div ref={pop} id={id} popover="auto" className="datepop" role="dialog" aria-label={`${label} calendar`} onToggle={(e) => setOpen(e.newState === "open")}>
        {open && (
          <>
            <div className="dp-head">
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(addMonths(cursor, -1))}>
                <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon n="chevron" size={16} /></span>
              </button>
              <b aria-live="polite">{monthName.format(view)}</b>
              <button type="button" className="icon-btn" aria-label="Next month" onClick={() => move(addMonths(cursor, 1))}>
                <Icon n="chevron" size={16} />
              </button>
            </div>
            <div className="dp-week" aria-hidden>{WEEK.map((w) => <span key={w}>{w.slice(0, 2)}</span>)}</div>
            <div className="dp-grid" onKeyDown={onKey}>
              {grid(view).map((d) => {
                const key = toKey(d);
                const outside = d.getMonth() !== view.getMonth();
                return (
                  <button
                    key={key}
                    type="button"
                    className="dp-day"
                    data-outside={outside || undefined}
                    data-today={key === today || undefined}
                    data-selected={key === value || undefined}
                    data-cursor={key === toKey(cursor)}
                    tabIndex={key === toKey(cursor) ? 0 : -1}
                    disabled={blocked(d)}
                    aria-label={full.format(d)}
                    aria-pressed={key === value}
                    onClick={() => pick(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="dp-foot">
              {quick.map((q) => (
                <button key={q.label} type="button" className="btn sm" disabled={blocked(q.d)} onClick={() => pick(q.d)}>{q.label}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
