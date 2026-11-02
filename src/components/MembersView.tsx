"use client";

import { NavLink } from "./NavLink";
import { useMemo, useTransition } from "react";
import { inviteMember, removeMember, revokeInvite, setMemberRole } from "@/app/actions";
import { dueInfo, duration, fmtDate } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { Member, ProjectRole, Task } from "@/lib/types";
import { withTransition } from "@/lib/motion";
import { useApp, useAppApi } from "@/store/app-store";
import { useProject, useProjectApi } from "@/store/project-store";
import { TaskTimer } from "./TaskCard";
import { Avatar, Icon } from "./ui";

export function MembersView() {
  const project = useProject((s) => s.project);
  const members = useProject((s) => s.members);
  const taskMap = useProject((s) => s.taskMap);
  const invites = useProject((s) => s.invites);
  const meId = useApp((s) => s.me.id);
  const api = useProjectApi();
  const app = useAppApi();
  const now = useNow();
  const [, start] = useTransition();

  const rows = useMemo(() => {
    const tasks = Object.values(taskMap);
    return members.map((m) => {
      const mine = tasks.filter((t) => t.assignee_id === m.user_id);
      const active = mine.filter((t) => t.status === "in_progress").sort((a, b) => a.due_at.localeCompare(b.due_at));
      const waiting = mine.filter((t) => t.status === "in_review" || t.status === "testing").length;
      return { m, active, waiting, open: mine.filter((t) => t.status !== "done").length };
    });
  }, [members, taskMap]);

  const toast = (text: string, tone: "success" | "danger" = "danger") => app.getState().toast({ text, tone });
  const isLate = (t: Task) => dueInfo(t, now).overdue;
  const lateTotal = rows.reduce((n, r) => n + r.active.filter(isLate).length, 0);

  const changeRole = (m: Member, role: ProjectRole) =>
    start(async () => {
      const prev = api.getState().members;
      api.getState().setMembers(prev.map((x) => (x.user_id === m.user_id ? { ...x, role } : x)));
      const r = await setMemberRole(project.id, m.user_id, role);
      if (!r.ok) {
        api.getState().setMembers(prev);
        toast(r.error);
      }
    });

  const remove = async (m: Member) => {
    const ok = await app.getState().ask({
      title: `Remove ${m.profile.full_name}?`,
      body: `They lose access to ${project.name}. Their unfinished tasks become unassigned.`,
      confirmLabel: "Remove member",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const r = await removeMember(project.id, m.user_id);
      if (!r.ok) return toast(r.error);
      withTransition(() => api.getState().setMembers(api.getState().members.filter((x) => x.user_id !== m.user_id)));
      toast(`${m.profile.full_name} was removed`, "success");
    });
  };

  return (
    <main className="page" style={{ maxWidth: 1180 }}>
      <div className="page-head">
        <div>
          <h1>Team workload</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 4 }}>
            What everyone is working on right now.{" "}
            {lateTotal > 0 ? <strong style={{ color: "var(--danger)" }}>{lateTotal} in-progress {lateTotal === 1 ? "task is" : "tasks are"} past due.</strong> : "Nothing in progress is past due."}
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Member</th><th>Role</th><th>In progress</th><th>Past due</th><th>In review / testing</th><th>Joined</th><th aria-label="Actions" />
            </tr>
          </thead>
          {rows.map(({ m, active, waiting }) => {
            const late = active.filter(isLate).length;
            return (
              <tbody key={m.user_id} style={{ viewTransitionName: `member-${m.user_id}` }}>
                <tr className="member-row" data-late={late > 0}>
                  <td>
                    <div className="person">
                      <Avatar name={m.profile.full_name} size={32} src={m.profile.avatar_url} />
                      <div>{m.profile.full_name}{m.user_id === meId && " (you)"}<small>{m.profile.email}</small></div>
                    </div>
                  </td>
                  <td>
                    <select className="role-select" aria-label={`Role of ${m.profile.full_name}`} value={m.role} onChange={(e) => changeRole(m, e.target.value as ProjectRole)}>
                      <option value="manager">Manager</option>
                      <option value="developer">Developer</option>
                      <option value="tester">Tester</option>
                    </select>
                  </td>
                  <td>{active.length}</td>
                  <td>{late > 0 ? <span className="chip" data-tone="danger"><Icon n="alert" size={12} /> {late}</span> : <span style={{ color: "var(--ink-3)" }}>0</span>}</td>
                  <td>{waiting}</td>
                  <td suppressHydrationWarning>{fmtDate(m.joined_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="icon-btn" aria-label={`Remove ${m.profile.full_name}`} onClick={() => remove(m)}><Icon n="trash" /></button>
                  </td>
                </tr>
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    {active.length === 0 ? (
                      <p className="tl-none">No tasks in progress.</p>
                    ) : (
                      <div className="tasklines">
                        {active.map((t) => {
                          const d = dueInfo(t, now);
                          return (
                            <NavLink key={t.id} href={`/projects/${project.id}?task=${t.id}`} className="taskline" data-overdue={d.overdue}>
                              <span className="k">{project.key}-{t.number}</span>
                              <span className="t">{t.title}</span>
                              <span className="m" suppressHydrationWarning>{t.started_at && now ? `Started ${duration(now - new Date(t.started_at).getTime())} ago` : "In progress"}</span>
                              <span className="m" suppressHydrationWarning>{d.overdue || d.label.startsWith("Due") ? d.label : `Due ${d.label}`}</span>
                              <span className="m">{t.estimate_hours != null ? `${t.estimate_hours}h` : "—"}</span>
                              <span className="m"><TaskTimer task={t} /></span>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <h2 className="section-title">Pending invitations</h2>
      {invites.length === 0 ? (
        <p className="empty" style={{ border: "1px dashed var(--line-strong)", borderRadius: 10 }}>No pending invitations. People you invite appear here until they accept.</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th>E-mail</th><th>Role</th><th>Sent</th><th>Expires</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td><span className="chip">{i.role}</span></td>
                  <td suppressHydrationWarning>{fmtDate(i.created_at)}</td>
                  <td suppressHydrationWarning>{fmtDate(i.expires_at)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn sm subtle" onClick={() => start(async () => {
                      const r = await inviteMember(project.id, i.email, i.role);
                      r.ok ? toast(`Invitation re-sent to ${i.email}`, "success") : toast(r.error);
                    })}>Resend</button>
                    <button className="btn sm subtle" onClick={() => start(async () => {
                      const r = await revokeInvite(i.id);
                      if (!r.ok) return toast(r.error);
                      withTransition(() => api.getState().setInvites(api.getState().invites.filter((x) => x.id !== i.id)));
                    })}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
