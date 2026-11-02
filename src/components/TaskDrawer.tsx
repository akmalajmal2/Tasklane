"use client";

import { useEffect, useState, useTransition } from "react";
import { archiveTask } from "@/app/actions";
import { withTransition } from "@/lib/motion";
import { useAppApi } from "@/store/app-store";
import { dueInfo, fmtDate, fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { fmtSize, isImage, signedUrls } from "@/lib/files";
import { STATUS_LABEL, canDelete, canEdit, movesFor, overrideMoves } from "@/lib/workflow";
import type { DecisionFile, Status, TaskEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useProject, useProjectApi } from "@/store/project-store";
import { useBoard } from "./board-context";
import { PriorityIcon, TaskTimer } from "./TaskCard";
import { TaskComments } from "./TaskComments";
import { Avatar, Icon, Modal, Spinner } from "./ui";

const TONE: Record<Status, string | undefined> = {
  proposed: "violet", declined: "danger", todo: undefined, in_progress: "brand", on_hold: "warn", in_review: "violet", testing: "warn", done: "ok",
};

export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  return (
    <Modal open={!!taskId} onClose={onClose} variant="drawer" label="Task details">
      {taskId && <Body id={taskId} onClose={onClose} />}
    </Modal>
  );
}

function who(members: { user_id: string; profile: { full_name: string } }[], id: string | null) {
  return members.find((m) => m.user_id === id)?.profile.full_name;
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const task = useProject((s) => s.taskMap[id]);
  const project = useProject((s) => s.project);
  const members = useProject((s) => s.members);
  const board = useBoard();
  const api = useProjectApi();
  const app = useAppApi();
  const [archiving, startArchive] = useTransition();
  const now = useNow();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const stamp = task?.updated_at;

  // Re-read the history whenever the card changes, including changes pushed live by teammates.
  useEffect(() => {
    if (!stamp) return;
    let alive = true;
    createClient()
      .from("task_events")
      .select("*, actor:profiles(full_name)")
      .eq("task_id", id)
      .order("created_at", { ascending: false })
      .then(({ data }) => alive && data && setEvents(data as unknown as TaskEvent[]));
    return () => {
      alive = false;
    };
  }, [id, stamp]);

  // The card was deleted by someone else while open.
  useEffect(() => {
    if (!task) onClose();
  }, [task, onClose]);
  if (!task) return null;

  const ref = `${project.key}-${task.number}`;
  const assignee = who(members, task.assignee_id);
  const reporter = who(members, task.reporter_id);
  const due = dueInfo(task, now);
  const moves = movesFor(task, board.ctx);
  const overrides = overrideMoves(task, board.ctx);
  const isManager = board.ctx.isManager;
  const mayEdit = canEdit(task, board.ctx);
  const mayDelete = canDelete(task, board.ctx);
  const pendingTask = task.status === "proposed" || task.status === "declined";
  const isOwner = task.reporter_id === board.ctx.userId;
  const withdraw = !isManager && mayDelete;
  const archived = !!task.archived_at;

  const toggleArchive = (archive: boolean) =>
    startArchive(async () => {
      const r = await archiveTask(task.id, archive);
      if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
      withTransition(() => api.getState().upsertTask(r.data, { force: true }));
      app.getState().toast({ text: archive ? `${ref} archived` : `${ref} restored to Completed`, tone: "success" });
      if (archive) onClose(); // an archived card leaves the board, so close its panel
    });

  return (
    <div className="drawer-wrap">
      <div className="drawer-head">
        <span style={{ fontWeight: 700 }}>{ref}</span>
        <span className="chip" data-tone={TONE[task.status]}>{STATUS_LABEL[task.status]}</span>
        <TaskTimer task={task} />
        {archived && <span className="chip">Archived</span>}
        <span className="spacer" />
        {mayEdit && (
          <button className="icon-btn" aria-label={pendingTask && !isManager ? "Revise proposal" : "Edit task"} onClick={() => board.edit(task)} title="Edit">
            <Icon n="edit" />
          </button>
        )}
        {isManager && task.status === "done" && (
          <button className="icon-btn" aria-label="Edit task" disabled title="Reopen to edit"><Icon n="edit" /></button>
        )}
        {mayDelete && (
          <button className="icon-btn" aria-label={withdraw ? "Withdraw proposal" : "Delete task"} title={withdraw ? "Withdraw" : "Delete"} onClick={() => board.remove(task)}>
            <Icon n="trash" />
          </button>
        )}
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
      </div>

      <div className="drawer-body">
        <div className="d-title">
        <h2>{task.title}</h2>

        {task.last_decision_note && (task.status === "todo" || task.status === "in_progress" || task.status === "on_hold") && (
          <p className="note-callout">Changes requested: {task.last_decision_note}</p>
        )}
        {task.last_decision_note && (task.status === "todo" || task.status === "in_progress" || task.status === "on_hold" || task.status === "declined") && (
          <FeedbackFiles files={task.last_decision_files ?? []} />
        )}
        {task.status === "proposed" && (
          <p className="banner" data-tone="violet">
            <Icon n="inbox" size={16} />
            <span>
              <b>Waiting for manager approval.</b> {isManager ? "Review it, adjust the details if needed, then approve." : "Nobody can start this until a manager approves it."}
            </span>
          </p>
        )}
        {task.status === "declined" && (
          <p className="banner" data-tone="danger">
            <Icon n="alert" size={16} />
            <span>
              <b>Declined{task.last_decision_note ? `: ${task.last_decision_note}` : "."}</b>{" "}
              {isOwner && !isManager ? "Revise it and resubmit, or withdraw it." : ""}
            </span>
          </p>
        )}

        </div>

        <div className="d-block">
        <dl className="props" style={{ margin: 0 }}>
          <dt>Assignee</dt>
          <dd>{assignee ? <><Avatar name={assignee} size={22} /> {assignee}</> : <span style={{ color: "var(--ink-3)" }}>Unassigned</span>}</dd>
          <dt>{pendingTask || task.status === "todo" ? "Proposed by" : "Reporter"}</dt>
          <dd>{reporter ?? "—"}</dd>
          <dt>Priority</dt>
          <dd><PriorityIcon p={task.priority} /> {task.priority[0]!.toUpperCase() + task.priority.slice(1)}</dd>
          <dt>Due</dt>
          <dd suppressHydrationWarning>
            {fmtDate(task.due_at)}
            {due.overdue && <span className="chip" data-tone="danger">{due.label}</span>}
          </dd>
          <dt>Estimate</dt>
          <dd>{task.estimate_hours != null ? `${task.estimate_hours} hours` : <span style={{ color: "var(--ink-3)" }}>Not estimated</span>}</dd>
          <dt>Testing</dt>
          <dd>{task.requires_testing ? <span className="chip" data-tone="warn"><Icon n="flask" size={12} /> Needs QA</span> : "Not required"}</dd>
          {task.started_at && (<><dt>Started</dt><dd suppressHydrationWarning>{fmtDateTime(task.started_at)}</dd></>)}
          {task.status === "in_review" && task.review_requested_at && (
            <><dt>In review since</dt><dd suppressHydrationWarning>{fmtDateTime(task.review_requested_at)}</dd></>
          )}
          {task.completed_at && (<><dt>Completed</dt><dd suppressHydrationWarning>{fmtDateTime(task.completed_at)}</dd></>)}
        </dl>
        </div>

        <section className="d-block">
          <h3 className="legend" style={{ marginBottom: 6 }}>Description</h3>
          {task.description ? <p className="desc">{task.description}</p> : <p style={{ color: "var(--ink-3)" }}>No description.</p>}
        </section>

        <TaskComments taskId={task.id} />

        <section className="d-block tint">
          <h3 className="legend" style={{ marginBottom: 10 }}>Activity</h3>
          <ul className="activity">
            {events.map((e) => (
              <li key={e.id}>
                <div>
                  <b>{e.actor?.full_name ?? "Someone"}</b>{" "}
                  {e.kind === "created" && "created this task"}
                  {e.kind === "proposed" && "proposed this task"}
                  {e.kind === "resubmitted" && "revised and resubmitted the proposal"}
                  {e.kind === "approved_proposal" && "approved the proposal"}
                  {e.kind === "override" && e.from_status && e.to_status && `moved it manually from ${STATUS_LABEL[e.from_status]} to ${STATUS_LABEL[e.to_status]}`}
                  {e.kind === "edited" && "edited the task"}
                  {e.kind === "archived" && "archived the task"}
                  {e.kind === "unarchived" && "restored the task from the archive"}
                  {e.kind === "reassigned" && "changed the assignee"}
                  {e.kind === "moved" && e.from_status && e.to_status && (e.to_status === "declined" ? "declined the proposal" : `moved it from ${STATUS_LABEL[e.from_status]} to ${STATUS_LABEL[e.to_status]}`)}
                  <br />
                  <time suppressHydrationWarning>{fmtDateTime(e.created_at)}</time>
                  {e.note && <blockquote style={{ whiteSpace: "pre-wrap" }}>{e.note}</blockquote>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(moves.length > 0 || overrides.length > 0 || (isManager && task.status === "done") || (task.status === "todo" && !task.assignee_id && isManager) || (!isManager && isOwner && pendingTask)) && (
        <div className="drawer-actions">
          {moves.map((m) => (
            <button key={m.kind} className={`btn ${m.tone === "primary" ? "primary" : m.tone === "danger" ? "danger" : m.kind === "pause" ? "danger-outline" : ""}`} onClick={() => board.requestMove(task, m)}>
              {m.label}
            </button>
          ))}
          {isManager && task.status === "done" && (
            <button className="btn" disabled={archiving} onClick={() => toggleArchive(!archived)}>
              {archiving ? <Spinner /> : <Icon n="archive" size={14} />} {archived ? "Restore from archive" : "Archive"}
            </button>
          )}
          {task.status === "todo" && !task.assignee_id && isManager && (
            <button className="btn primary" onClick={() => board.edit(task)}>Assign to start</button>
          )}
          {!isManager && isOwner && pendingTask && (
            <button className="btn primary" onClick={() => board.edit(task)}>{task.status === "declined" ? "Revise & resubmit" : "Edit proposal"}</button>
          )}
          {overrides.length > 0 && (
            <label className="move-to">
              <span className="sr">Move to another column (manager override)</span>
              <Icon n="shuffle" size={14} />
              <select
                value=""
                aria-label="Move to another column (manager override)"
                onChange={(e) => {
                  const m = overrides.find((o) => o.to === e.target.value);
                  if (m) board.requestMove(task, m);
                }}
              >
                <option value="">Move to…</option>
                {overrides.map((m) => <option key={m.to} value={m.to}>{STATUS_LABEL[m.to]}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Photos and PDFs the reviewer attached to their remark. Files are private, so links are signed on demand. */
function FeedbackFiles({ files }: { files: DecisionFile[] }) {
  const key = files.map((f) => f.path).join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!files.length) return;
    let alive = true;
    signedUrls(files).then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!files.length) return null;
  return (
    <ul className="file-grid" aria-label="Attached files">
      {files.map((f) => {
        const href = urls[f.path];
        const inner = isImage(f.type) && href ? (
          <img src={href} alt={f.name} className="file-preview" />
        ) : (
          <span className="file-doc"><Icon n="file" size={20} /></span>
        );
        return (
          <li key={f.path}>
            <a className="file-card" href={href} target="_blank" rel="noopener noreferrer" aria-disabled={!href} title={f.name}>
              {inner}
              <span className="file-meta"><b>{f.name}</b><small>{fmtSize(f.size)}</small></span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
