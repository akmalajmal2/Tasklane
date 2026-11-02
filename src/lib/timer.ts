import type { Task } from "./types";

/**
 * How different a face in the camera may be from the one captured at account setup and still count as
 * the same person (Euclidean distance between face descriptors; the library's usual cut-off is 0.6,
 * lower = stricter).
 */
export const MATCH_DISTANCE = 0.55;
/** How long the account holder may be missing before the clock stops (a glance away must not pause it). */
export const AWAY_MS = 8_000;
/** Consecutive 1-second checks that recognise the account holder before a paused clock resumes by itself. */
export const RESUME_FRAMES = 2;
/** No keyboard / mouse / touch anywhere on the computer for this long counts as idle (Chrome / Edge). */
export const IDLE_MS = 120_000;
/** A gap this long between two 1-second checks means the computer slept or was locked. */
export const SLEEP_GAP_MS = 15_000;
/** The browser that runs the clock reports in this often. */
export const HEARTBEAT_MS = 40_000;
/** The camera and face models (a few MB the first time) get this long to start before the clock is stopped. */
export const START_GRACE_MS = 60_000;

export function elapsedSeconds(t: Pick<Task, "worked_seconds" | "timer_started_at">, now: number): number {
  const base = t.worked_seconds ?? 0;
  if (!t.timer_started_at || !now) return base;
  return base + Math.max(0, Math.floor((now - new Date(t.timer_started_at).getTime()) / 1000));
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

export const PAUSE_LABEL: Record<string, string> = {
  away: "Paused · away from camera",
  other: "Paused · not you at the camera",
  idle: "Paused · no activity",
  locked: "Paused · screen locked",
  sleep: "Paused · computer was asleep",
  camera: "Paused · camera off",
  offline: "Paused · connection lost",
  waiting: "Waiting for you at the camera",
};
