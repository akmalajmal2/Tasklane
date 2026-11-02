"use client";

import { useEffect, useState, type CSSProperties, type DragEvent } from "react";
import { dueInfo } from "@/lib/format";
import { elapsedSeconds, fmtClock } from "@/lib/timer";
import type { Priority, Task } from "@/lib/types";
import { Avatar, Icon } from "./ui";

const ARROWS: Record<Priority, string> = {
  urgent: "M6 14l6-6 6 6M6 19l6-6 6 6",
  high: "M6 15l6-6 6 6",
  medium: "M6 9h12M6 15h12",
  low: "M6 9l6 6 6-6",
};

export function PriorityIcon({ p }: { p: Priority }) {
  return (
    <span className="pri" data-p={p} title={`${p[0]!.toUpperCase()}${p.slice(1)} priority`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ARROWS[p]} />
      </svg>
    </span>
  );
}

/** Time worked on a task. Ticks every second while its clock runs. */
export function TaskTimer({ task }: { task: Task }) {
  const running = task.status === "in_progress" && !!task.timer_started_at;
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, task.timer_started_at]);
  const secs = elapsedSeconds(task, now);
  if (secs <= 0 && task.status !== "in_progress") return null;
  const state = running ? "run" : task.status === "in_progress" ? "pause" : "idle";
  return (
    <span className="clock" data-state={state} title={running ? "Timer running" : task.status === "in_progress" ? "Timer paused (you are away)" : "Time worked"} suppressHydrationWarning>
      <i aria-hidden /> {fmtClock(secs)}
    </span>
  );
}

export function TaskCard({
  task, index, refKey, assignee, assigneePhoto, proposer, now, flash, draggable, dragging, onOpen, onDragStart, onDragEnd,
}: {
  task: Task;
  index: number;
  refKey: string;
  assignee?: string;
  assigneePhoto?: string | null;
  proposer?: string;
  now: number;
  flash: number;
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const due = dueInfo(task, now);
  const sentBack = (task.status === "todo" || task.status === "in_progress" || task.status === "on_hold") && !!task.last_decision_note;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card${flash ? " flash" : ""}`}
      style={{ "--i": Math.min(index, 8), viewTransitionName: `card-${task.id}` } as CSSProperties}
      data-status={task.status}
      data-p={task.priority}
      data-overdue={due.overdue}
      data-dragging={dragging}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${refKey} ${task.title}`}
    >
      <span className="card-top">
        <PriorityIcon p={task.priority} />
        <span className="card-ref">{refKey}</span>
        {task.requires_testing && (
          <span className="chip sm" data-tone="warn" title="Needs testing before completion">
            <Icon n="flask" size={11} /> QA
          </span>
        )}
        <span className="grow">
          {assignee ? <Avatar name={assignee} size={24} src={assigneePhoto} /> : <span title="Unassigned" className="avatar unassigned" style={{ width: 24, height: 24 }} />}
        </span>
      </span>
      <span className="card-title">{task.title}</span>
      {sentBack && (
        <span className="note-callout">
          Changes requested: {task.last_decision_note}
          {(task.last_decision_files?.length ?? 0) > 0 && <em className="file-count"><Icon n="paperclip" size={11} /> {task.last_decision_files.length}</em>}
        </span>
      )}
      {task.status === "proposed" && (
        <span className="await"><i aria-hidden /> Awaiting approval{proposer ? ` · ${proposer}` : ""}</span>
      )}
      {task.status === "declined" && <span className="note-callout">Declined{task.last_decision_note ? `: ${task.last_decision_note}` : ""}</span>}
      <span className="card-meta">
        <span className="due" data-overdue={due.overdue} title="Due date" suppressHydrationWarning>
          <Icon n="calendar" size={12} /> {due.label}
        </span>
        <TaskTimer task={task} />
        {task.archived_at && <span className="chip sm">Archived</span>}
        {task.estimate_hours != null && (
          <span className="est" title="Estimated effort">
            <Icon n="timer" size={12} /> {task.estimate_hours}h
          </span>
        )}
      </span>
    </div>
  );
}
