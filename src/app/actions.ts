"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deliver, sendInvite } from "@/lib/email";
import type { DecisionFile, Notified, TaskComment, Priority, ProjectRole, Project, Result, Status, Task } from "@/lib/types";

/* ------------------------------------------------------------ helpers */

function fail(e: unknown): { ok: false; error: string; stale?: boolean } {
  const raw =
    typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong";
  // A missing function means the database has not been updated with the latest SQL yet.
  if (/schema cache|Could not find the function/i.test(raw)) {
    return {
      ok: false,
      error: "The database is out of date. Run the newest SQL files in supabase/ (see supabase/README.md: v7, v11, then v12a and v12b), then try again.",
    };
  }
  return { ok: false, error: raw.replace(/^STALE:\s*/, ""), stale: raw.startsWith("STALE:") };
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired. Sign in again.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

const mailLater = (list: Notified[]) => after(() => deliver(list));

/* --------------------------------------------------------------- auth */

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/* ----------------------------------------------------------- projects */

export async function createProject(input: { key: string; name: string; description: string }): Promise<Result<Project>> {
  try {
    const p = await rpc<Project>("create_project", {
      p_key: input.key,
      p_name: input.name,
      p_description: input.description,
    });
    return { ok: true, data: p };
  } catch (e) {
    return fail(e);
  }
}

/** Only the project's creator can delete it. The key must be typed again as a safety check. */
export async function deleteProject(projectId: string, confirmKey: string): Promise<Result> {
  try {
    await rpc("delete_project", { p_project: projectId, p_confirm_key: confirmKey });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function setAdmin(userId: string, admin: boolean): Promise<Result> {
  try {
    await rpc("set_admin", { p_user: userId, p_admin: admin });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/* -------------------------------------------------------------- tasks */

export interface TaskInput {
  title: string;
  description: string;
  priority: Priority;
  requires_testing: boolean;
  estimate_hours: number | null;
  due_at: string;
  assignee_id: string | null;
}

const taskArgs = (i: TaskInput) => ({
  p_title: i.title,
  p_description: i.description,
  p_priority: i.priority,
  p_requires_testing: i.requires_testing,
  p_estimate: i.estimate_hours,
  p_due: i.due_at,
  p_assignee: i.assignee_id,
});

export async function createTask(projectId: string, input: TaskInput): Promise<Result<Task>> {
  try {
    const r = await rpc<{ task: Task; notified: Notified[] }>("create_task", { p_project: projectId, ...taskArgs(input) });
    mailLater(r.notified);
    return { ok: true, data: r.task };
  } catch (e) {
    return fail(e);
  }
}

export async function updateTask(taskId: string, input: TaskInput): Promise<Result<Task>> {
  try {
    const r = await rpc<{ task: Task; notified: Notified[] }>("update_task", { p_task: taskId, ...taskArgs(input) });
    mailLater(r.notified);
    return { ok: true, data: r.task };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTask(taskId: string): Promise<Result> {
  try {
    await rpc("delete_task", { p_task: taskId });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** A manager reviews a proposal: they may adjust the details, then it moves to To do. */
export async function approveTask(taskId: string, input: TaskInput, note?: string): Promise<Result<Task>> {
  try {
    const r = await rpc<{ task: Task; notified: Notified[] }>("approve_task", {
      p_task: taskId,
      ...taskArgs(input),
      p_note: note ?? null,
    });
    mailLater(r.notified);
    return { ok: true, data: r.task };
  } catch (e) {
    return fail(e);
  }
}

export async function transitionTask(
  taskId: string,
  from: Status,
  to: Status,
  note?: string,
  override = false,
): Promise<Result<Task>> {
  try {
    const r = await rpc<{ task: Task; notified: Notified[] }>("transition_task", {
      p_task: taskId,
      p_from: from,
      p_to: to,
      p_note: note ?? null,
      p_override: override,
    });
    mailLater(r.notified);
    return { ok: true, data: r.task };
  } catch (e) {
    return fail(e);
  }
}

/** Attach the already-uploaded photos / PDFs to the remark the caller just wrote. */
export async function setDecisionFiles(taskId: string, files: DecisionFile[]): Promise<Result<Task>> {
  try {
    const t = await rpc<Task>("set_decision_files", { p_task: taskId, p_files: files });
    return { ok: true, data: t };
  } catch (e) {
    return fail(e);
  }
}

/** A manager drags a card to a new spot inside (or into) a column. */
export async function reorderTask(taskId: string, position: number): Promise<Result<Task>> {
  try {
    const t = await rpc<Task>("reorder_task", { p_task: taskId, p_position: position });
    return { ok: true, data: t };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------- members + invites */

export async function inviteMember(projectId: string, email: string, role: ProjectRole): Promise<Result> {
  try {
    const inv = await rpc<{ token: string; email: string; role: string; project_name: string; inviter_name: string }>(
      "create_invite",
      { p_project: projectId, p_email: email, p_role: role },
    );
    after(() => sendInvite(inv));
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInvite(inviteId: string): Promise<Result> {
  try {
    await rpc("revoke_invite", { p_invite: inviteId });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptInvite(token: string): Promise<Result<{ project_id: string }>> {
  try {
    const r = await rpc<{ project_id: string; notified: Notified[] }>("accept_invite", { p_token: token });
    mailLater(r.notified);
    return { ok: true, data: { project_id: r.project_id } };
  } catch (e) {
    return fail(e);
  }
}

export async function declineInvite(token: string): Promise<Result> {
  try {
    await rpc("decline_invite", { p_token: token });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<Result> {
  try {
    await rpc("set_member_role", { p_project: projectId, p_user: userId, p_role: role });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMember(projectId: string, userId: string): Promise<Result> {
  try {
    await rpc("remove_member", { p_project: projectId, p_user: userId });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------ profile */

export async function updateProfile(name: string, muteEmail: string[]): Promise<Result<{ full_name: string; mute_email: string[] }>> {
  try {
    const r = await rpc<{ full_name: string; mute_email: string[] }>("update_my_profile", { p_name: name, p_mute: muteEmail });
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

/** Replaces the profile photo (a small JPEG data URL from the camera), or removes it with null. */
export async function updateAvatar(avatar: string | null): Promise<Result<string | null>> {
  try {
    const r = await rpc<string | null>("set_my_avatar", { p_avatar: avatar });
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

/* ----------------------------------------------------------- comments */

export async function addComment(taskId: string, body: string): Promise<Result<TaskComment>> {
  try {
    const r = await rpc<{ comment: Omit<TaskComment, "author">; notified: Notified[] }>("add_comment", { p_task: taskId, p_body: body });
    mailLater(r.notified);
    return { ok: true, data: { ...r.comment, author: null } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteComment(commentId: string): Promise<Result> {
  try {
    await rpc("delete_comment", { p_comment: commentId });
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------ archive */

export async function archiveTask(taskId: string, archive: boolean): Promise<Result<Task>> {
  try {
    const t = await rpc<Task>("archive_task", { p_task: taskId, p_archive: archive });
    return { ok: true, data: t };
  } catch (e) {
    return fail(e);
  }
}

/** Archives every completed task of the project. Returns the rows that changed. */
export async function archiveDone(projectId: string): Promise<Result<Task[]>> {
  try {
    const list = await rpc<Task[]>("archive_done", { p_project: projectId });
    return { ok: true, data: list };
  } catch (e) {
    return fail(e);
  }
}
