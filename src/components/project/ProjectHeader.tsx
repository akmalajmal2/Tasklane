"use client";

import { useState } from "react";
import { DeleteProjectDialog } from "@/components/project/DeleteProject";
import { NavLink } from "@/components/layout/NavLink";
import { usePathname } from "next/navigation";
import { useProject } from "@/store/project-store";
import { Icon } from "@/components/common/ui";
import { canManageProject } from "@/lib/workflow";

export function ProjectHeader() {
  const path = usePathname();
  const project = useProject((s) => s.project);
  const me = useProject((s) => s.me);
  const setInviteOpen = useProject((s) => s.setInviteOpen);
  const pendingInvites = useProject((s) => s.invites.length);
  const isManager = canManageProject(me.isAdmin, me.role);
  const isCreator = project.created_by === me.id; // only the creator may delete the project
  const [deleting, setDeleting] = useState(false);
  const base = `/projects/${project.id}`;

  return (
    <div className="proj-head">
      <div className="crumbs">
        <NavLink href="/projects" dir="back">Projects</NavLink> / {project.key}
      </div>
      <div className="row">
        <h1>{project.name}</h1>
        <span className="chip" data-tone={isManager ? "brand" : undefined}>{me.role ?? "admin"}</span>
        {(isManager || isCreator) && (
          <span className="head-actions">
            {isManager && (
              <button className="btn sm" onClick={() => setInviteOpen(true)}>
                <Icon n="mail" size={14} /> Invite people
              </button>
            )}
            {isCreator && (
              <button className="icon-btn danger-ghost" aria-label="Delete project" title="Delete project (creator only)" onClick={() => setDeleting(true)}>
                <Icon n="trash" size={16} />
              </button>
            )}
          </span>
        )}
      </div>
      {!isManager && (
        <p className="sub" style={{ margin: "2px 0 0", color: "var(--ink-2)", fontSize: 13 }}>
          You see your own tasks, tasks you proposed, and approved cards nobody has taken yet. Managers see everything.
        </p>
      )}
      <nav className="tabs" aria-label="Project">
        <NavLink kind="tab" dir="back" href={base} aria-current={path === base ? "page" : undefined}>Board</NavLink>
        {isManager && (
          <NavLink kind="tab" dir="forward" href={`${base}/members`} aria-current={path.endsWith("/members") ? "page" : undefined}>
            Members{pendingInvites > 0 && ` · ${pendingInvites} pending`}
          </NavLink>
        )}
      </nav>
      {isCreator && <DeleteProjectDialog open={deleting} onClose={() => setDeleting(false)} />}
    </div>
  );
}
