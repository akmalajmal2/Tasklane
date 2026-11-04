"use client";

import { useState, useTransition } from "react";
import { announceMove } from "@/lib/timer";
import { approveTask, createTask, updateTask, type TaskInput } from "@/app/actions";
import { endOfDayIso, toLocalDate } from "@/lib/format";
import { withTransition } from "@/lib/motion";
import { PRIORITIES, canManageProject } from "@/lib/workflow";
import type { Member, Priority, Task } from "@/lib/types";
import { useApp, useAppApi } from "@/store/app-store";
import { useProject, useProjectApi } from "@/store/project-store";
import { DatePicker } from "@/components/common/DatePicker";
import { Icon, Modal, Spinner } from "@/components/common/ui";

export type FormState = { mode: "create" } | { mode: "edit"; task: Task } | { mode: "review"; task: Task } | null;

export function TaskFormDialog({ state, onClose }: { state: FormState; onClose: () => void }) {
  const label = !state ? "" : state.mode === "review" ? "Review proposal" : state.mode === "edit" ? "Edit task" : "Create task";
  return (
    <Modal open={!!state} onClose={onClose} label={label}>
      {state && <Form state={state} onClose={onClose} />}
    </Modal>
  );
}

/** Read the shared field set out of a <form>. Estimate is optional: empty means "not estimated yet". */
function readInput(f: FormData, prevDue?: string): TaskInput {
  const est = String(f.get("estimate") ?? "").trim();
  return {
    title: String(f.get("title")).trim(),
    description: String(f.get("description") ?? "").trim(),
    priority: String(f.get("priority")) as Priority,
    requires_testing: f.get("testing") === "yes",
    estimate_hours: est ? Number(est) : null,
    // Date only: the day means "by the end of that day". An untouched date keeps its stored time.
    due_at: prevDue && toLocalDate(prevDue) === String(f.get("due")) ? prevDue : endOfDayIso(String(f.get("due"))),
    assignee_id: String(f.get("assignee")) || null,
  };
}

function Fields({ task, members, isManager, meId, review }: { task?: Task; members: Member[]; isManager: boolean; meId: string; review?: boolean }) {
  const minDue = toLocalDate(new Date().toISOString());
  // Past due dates are only allowed to stay as-is when editing; approving always needs a future date.
  const dueMin = review || !task ? minDue : undefined;
  // You first, so "(me)" is always at the top of the list.
  const people = (isManager ? [...members] : members.filter((m) => m.user_id === meId)).sort((a, b) => Number(b.user_id === meId) - Number(a.user_id === meId));
  return (
    <>
      <label className="field">
        <span>Title</span>
        <input type="text" name="title" required minLength={3} maxLength={160} defaultValue={task?.title} autoFocus placeholder="What needs to be done?" />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea name="description" rows={4} defaultValue={task?.description} placeholder="Context, acceptance criteria, links" />
      </label>

      <fieldset className="field plain">
        <legend className="legend">Does this task need testing?</legend>
        <div className="seg">
          <label><input type="radio" name="testing" value="yes" required defaultChecked={task?.requires_testing === true} /><span>Yes, QA must pass it</span></label>
          <label><input type="radio" name="testing" value="no" defaultChecked={task?.requires_testing === false} /><span>No, review is enough</span></label>
        </div>
      </fieldset>

      <div className="grid2">
        <label className="field">
          <span>Estimate (hours) <em className="opt">optional</em></span>
          <input type="number" name="estimate" min={0.5} max={999} step={0.5} defaultValue={task?.estimate_hours ?? undefined} placeholder={isManager ? "e.g. 6" : "Your guess, if any"} />
          <small>{isManager ? "Planning aid only. Leave empty if unknown." : "A manager confirms this when approving."}</small>
        </label>
        <div className="field">
          <span>{isManager ? "Due date" : "Proposed due date"}</span>
          <DatePicker name="due" label={isManager ? "Due date" : "Proposed due date"} min={dueMin} defaultValue={task ? toLocalDate(task.due_at) : ""} />
        </div>
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue={task?.priority ?? "medium"}>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{isManager ? "Assignee" : "Who will do it"}</span>
          <select name="assignee" defaultValue={task?.assignee_id ?? ""}>
            <option value="">{isManager ? "Unassigned" : "Unassigned · manager decides"}</option>
            {people.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.profile.full_name}{m.user_id === meId ? " (me)" : ""} · {m.role}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function Form({ state, onClose }: { state: NonNullable<FormState>; onClose: () => void }) {
  const project = useProject((s) => s.project);
  const members = useProject((s) => s.members);
  const meP = useProject((s) => s.me);
  const me = useApp((s) => s.me);
  const api = useProjectApi();
  const app = useAppApi();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const task = state.mode === "create" ? undefined : state.task;
  const review = state.mode === "review";
  const isManager = canManageProject(meP.isAdmin, meP.role);
  const resubmit = !!task && !isManager && task.status === "declined";

  const title = review
    ? `Review ${project.key}-${task!.number}`
    : task
      ? resubmit ? `Revise & resubmit ${project.key}-${task.number}` : `Edit ${project.key}-${task.number}`
      : isManager ? "Create task" : "Propose a task";

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!String(f.get("due") ?? "")) return setError("Pick a due date.");
        const input = readInput(f, task?.due_at);
        const dueChanged = !task || input.due_at !== task.due_at;
        if ((dueChanged || review) && new Date(input.due_at).getTime() <= Date.now()) return setError("Pick today or a later date.");
        setError("");
        start(async () => {
          let r;
          if (review) r = await approveTask(task!.id, input, String(f.get("note") ?? "").trim() || undefined);
          else if (task) r = await updateTask(task.id, input);
          else r = await createTask(project.id, input);
          announceMove();
          if (!r.ok) return setError(r.error);
          withTransition(() => api.getState().upsertTask(r.data, { force: true }));
          const ref = `${project.key}-${r.data.number}`;
          app.getState().toast({
            text: review ? `${ref} approved and ready to start` : task ? (resubmit ? `${ref} resubmitted for approval` : `${ref} updated`) : isManager ? `${ref} created` : `${ref} submitted for manager approval`,
            tone: "success",
          });
          onClose();
        });
      }}
    >
      <header className="dlg-head">
        <h2>{title}</h2>
        {review && <p className="sub">Adjust anything you need (due date, estimate, assignee), then approve. The proposer is told what you changed.</p>}
        {!task && !isManager && <p className="sub">A manager reviews your task first. It can be started once approved.</p>}
        {task?.status === "declined" && task.last_decision_note && <p className="note-callout" style={{ marginTop: 8 }}>Declined: {task.last_decision_note}</p>}
      </header>

      <div className="dlg-body">
      <Fields task={task} members={members} isManager={isManager} meId={me.id} review={review} />

      {review && (
        <label className="field">
          <span>Note to the proposer <em className="opt">optional</em></span>
          <textarea name="note" rows={2} placeholder="e.g. Moved the due date to fit the release." />
        </label>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={pending}>
          {pending ? <Spinner /> : review ? <Icon n="check" size={14} /> : null}{" "}
          {review ? "Approve" : task ? (resubmit ? "Resubmit for approval" : "Save changes") : isManager ? "Create task" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}
