import type { Priority, ProjectRole, Status, Task } from "./types";

/** Board lanes in order. "Declined" is an optional lane (see DECLINED_COLUMN). */
export const COLUMNS: { id: Status; label: string; hint: string }[] = [
  { id: "proposed", label: "Proposed", hint: "Waiting for manager approval" },
  { id: "todo", label: "To do", hint: "Approved · not started" },
  { id: "in_progress", label: "In progress", hint: "Being worked on · timer running" },
  { id: "on_hold", label: "On hold", hint: "Paused · resume any time" },
  { id: "in_review", label: "In review", hint: "Waiting for approval" },
  { id: "testing", label: "In testing", hint: "Completed · QA pending" },
  { id: "done", label: "Completed", hint: "Approved" },
];
export const DECLINED_COLUMN = { id: "declined" as Status, label: "Declined", hint: "Proposer can revise or withdraw" };

export const STATUS_LABEL: Record<Status, string> = {
  proposed: "Proposed",
  declined: "Declined",
  todo: "To do",
  in_progress: "In progress",
  on_hold: "On hold",
  in_review: "In review",
  testing: "In testing",
  done: "Completed",
};

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

type MoveKind =
  | "start" | "pause" | "hold" | "resume" | "submit" | "approve" | "reject" | "pass" | "fail" | "reopen"
  | "approve_proposal" | "decline" | "override";
export interface Move {
  to: Status;
  kind: MoveKind;
  label: string;
  note: "none" | "required";
  tone: "primary" | "danger" | "neutral";
}

export interface MoveCtx {
  userId: string;
  isManager: boolean; // project manager or workspace admin
  role: ProjectRole | null;
  hasTesters: boolean;
  otherApprovers: number;
  otherTesters: number;
}

const isPending = (t: Task) => t.status === "proposed" || t.status === "declined";

/** Managers edit anything not done; a proposer edits their own pending proposal. */
export const canEdit = (t: Task, c: MoveCtx) =>
  c.isManager ? t.status !== "done" : t.reporter_id === c.userId && isPending(t);

/** Managers delete anything; a proposer may withdraw their own pending proposal. */
export const canDelete = (t: Task, c: MoveCtx) => c.isManager || (t.reporter_id === c.userId && isPending(t));

/** Can't approve a proposal you wrote yourself if someone else could (mirrors approve_task). */
const canReviewProposal = (t: Task, c: MoveCtx) =>
  c.isManager && !(t.reporter_id === c.userId && c.otherApprovers > 0);

/**
 * Mirror of public.transition_task() so the UI only offers moves the database
 * will accept. The database stays the source of truth; this is for UX.
 */
export function movesFor(t: Task, c: MoveCtx): Move[] {
  const mine = t.assignee_id === c.userId;
  const out: Move[] = [];
  switch (t.status) {
    case "proposed":
    case "declined":
      if (canReviewProposal(t, c)) {
        out.push({ to: "todo", kind: "approve_proposal", label: "Review & approve", note: "none", tone: "primary" });
        if (t.status === "proposed") out.push({ to: "declined", kind: "decline", label: "Decline", note: "required", tone: "danger" });
      }
      break;
    case "todo":
      // Only the assignee starts work. Unassigned cards can be picked up by non-managers.
      if (t.assignee_id ? mine : !c.isManager) {
        out.push({
          to: "in_progress",
          kind: "start",
          label: t.assignee_id ? "Start work" : "Take and start",
          note: "none",
          tone: "primary",
        });
      }
      break;
    case "in_progress":
      if (t.assignee_id && mine) {
        out.push({ to: "in_review", kind: "submit", label: "Send for review", note: "none", tone: "primary" });
        out.push({ to: "on_hold", kind: "hold", label: "Put on hold", note: "none", tone: "neutral" });
        out.push({ to: "todo", kind: "pause", label: "Back to To do", note: "none", tone: "neutral" });
      }
      break;
    case "on_hold":
      // Only the assignee resumes. Starting another task also parks the current one here automatically.
      if (t.assignee_id && mine) {
        out.push({ to: "in_progress", kind: "resume", label: "Resume work", note: "none", tone: "primary" });
        out.push({ to: "todo", kind: "pause", label: "Back to To do", note: "none", tone: "neutral" });
      }
      break;
    case "in_review":
      if (c.isManager && !(mine && c.otherApprovers > 0)) {
        out.push({
          to: t.requires_testing ? "testing" : "done",
          kind: "approve",
          label: t.requires_testing ? "Approve · send to testing" : "Approve and complete",
          note: "none",
          tone: "primary",
        });
        out.push({ to: "todo", kind: "reject", label: "Send back to To do", note: "required", tone: "danger" });
      }
      break;
    case "testing": {
      const canTest = c.role === "tester" || (c.isManager && !c.hasTesters);
      if (canTest && !(mine && c.otherTesters > 0)) {
        out.push({ to: "done", kind: "pass", label: "Pass testing", note: "none", tone: "primary" });
        out.push({ to: "in_progress", kind: "fail", label: "Fail testing", note: "required", tone: "danger" });
      }
      break;
    }
    case "done":
      if (c.isManager) {
        out.push({ to: "in_progress", kind: "reopen", label: "Reopen", note: "required", tone: "neutral" });
      }
      break;
  }
  return out;
}

/**
 * Manager override: move a card to any lane outside the normal workflow, with a mandatory
 * reason that is logged and sent to the assignee. Mirrors transition_task(p_override => true).
 */
export function overrideMoves(t: Task, c: MoveCtx): Move[] {
  if (!c.isManager || isPending(t)) return [];
  const normal = new Set(movesFor(t, c).map((m) => m.to));
  const mine = t.assignee_id === c.userId;
  return COLUMNS.filter((col) => {
    if (col.id === "proposed" || col.id === t.status || normal.has(col.id)) return false;
    if (!t.assignee_id && col.id !== "todo") return false;
    if (col.id === "testing" && !t.requires_testing) return false;
    if (mine && c.otherApprovers > 0 && (col.id === "testing" || col.id === "done")) return false;
    return true;
  }).map((col) => ({ to: col.id, kind: "override" as const, label: `Move to ${col.label}`, note: "required" as const, tone: "neutral" as const }));
}

/** Why a card can't be moved by this person — shown when a drop is refused. */
export function whyNoMove(t: Task, c: MoveCtx): string {
  if (t.status === "proposed") return c.isManager ? "You can't approve your own proposal. Another manager has to." : "A manager has to approve this task before anyone can start it.";
  if (t.status === "declined") return "Declined proposals can be revised and resubmitted by their author.";
  if (t.status === "todo" && !t.assignee_id && c.isManager) return "Assign this task to someone before starting it.";
  if (t.status === "todo" && t.assignee_id && t.assignee_id !== c.userId) return "Only the person it is assigned to can start this task.";
  if (t.status === "in_progress" && t.assignee_id) return "Only the person it is assigned to can send it for review or move it back.";
  if (t.status === "on_hold") return "Only the person it is assigned to can resume this task.";
  if (t.status === "in_review" && !c.isManager) return "Only a manager can approve or send back a review.";
  if (t.status === "in_review" && t.assignee_id === c.userId) return "You can't review your own task. Another manager has to.";
  if (t.status === "testing") return "Only a tester can pass or fail testing.";
  if (t.status === "done") return "Only a manager can reopen a completed task.";
  return "You can only move tasks that are assigned to you.";
}

export function describeMove(from: Status, to: Status, ref: string): { text: string; tone: "info" | "success" | "danger" } {
  if (from === "proposed" && to === "declined") return { text: `declined ${ref}`, tone: "danger" };
  if ((from === "proposed" || from === "declined") && to === "todo") return { text: `approved ${ref}`, tone: "success" };
  if (from === "in_progress" && to === "on_hold") return { text: `put ${ref} on hold`, tone: "info" };
  if (from === "on_hold" && to === "in_progress") return { text: `resumed ${ref}`, tone: "info" };
  if (from === "in_progress" && to === "in_review") return { text: `sent ${ref} for review`, tone: "info" };
  if (from === "in_review" && to === "testing") return { text: `approved ${ref} and sent it to testing`, tone: "success" };
  if (from === "in_review" && to === "done") return { text: `approved ${ref}`, tone: "success" };
  if (from === "in_review" && to === "todo") return { text: `sent ${ref} back with feedback`, tone: "danger" };
  if (from === "testing" && to === "done") return { text: `passed testing on ${ref}`, tone: "success" };
  if (from === "testing" && to === "in_progress") return { text: `failed testing on ${ref}`, tone: "danger" };
  if (from === "done" && to === "in_progress") return { text: `reopened ${ref}`, tone: "info" };
  return { text: `moved ${ref} to ${STATUS_LABEL[to]}`, tone: "info" };
}
