export type Status = "proposed" | "declined" | "todo" | "in_progress" | "on_hold" | "in_review" | "testing" | "done";
export type ProjectRole = "manager" | "developer" | "tester";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  /** Small JPEG (data URL) taken at sign-up. */
  avatar_url: string | null;
  /** Notification groups the user does not want e-mailed (they still appear in the app). */
  mute_email: string[];
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  /** Who created the project; only they may delete it. */
  created_by: string | null;
}

export interface Member {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  joined_at: string;
  profile: Pick<Profile, "id" | "email" | "full_name" | "avatar_url">;
}

export interface Invite {
  id: string;
  project_id: string;
  email: string;
  role: ProjectRole;
  token: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  created_at: string;
  expires_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  priority: Priority;
  status: Status;
  /** Manual order inside a column (lower = higher up). */
  position: number;
  requires_testing: boolean;
  estimate_hours: number | null;
  due_at: string;
  assignee_id: string | null;
  reporter_id: string | null;
  updated_by: string | null;
  started_at: string | null;
  review_requested_at: string | null;
  completed_at: string | null;
  /** Set when a manager archives a completed task; archived tasks leave the board. */
  archived_at: string | null;
  /** Seconds already worked (clock stopped). Add the time since timer_started_at while it runs. */
  worked_seconds: number;
  /** Set while the work clock is running. */
  timer_started_at: string | null;
  /** Why the clock is stopped on an In progress card: away, idle, locked, sleep, camera, offline, waiting. */
  timer_pause_reason: string | null;
  last_decision_note: string | null;
  /** Photos / PDFs attached to the current remark. */
  last_decision_files: DecisionFile[];
  created_at: string;
  updated_at: string;
}

export interface DecisionFile {
  /** Storage path: <project id>/<task id>/<file> */
  path: string;
  name: string;
  type: string;
  size: number;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  actor_id: string | null;
  kind: "created" | "proposed" | "resubmitted" | "approved_proposal" | "edited" | "reassigned" | "moved" | "override" | "archived" | "unarchived";
  from_status: Status | null;
  to_status: Status | null;
  note: string | null;
  created_at: string;
  actor: { full_name: string } | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  project_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author: { full_name: string } | null;
}

export interface Notice {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface MyInvite {
  token: string;
  role: ProjectRole;
  project_name: string;
  project_key: string;
  inviter_name: string | null;
  created_at: string;
}

/** Shape the SQL functions return for people who must be e-mailed. */
export interface Notified {
  email: string;
  name: string;
  title: string;
  body: string;
  link: string | null;
}

export type Result<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; stale?: boolean };
