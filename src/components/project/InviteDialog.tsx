"use client";

import { useState, useTransition } from "react";
import { inviteMember } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";
import { useApp, useAppApi } from "@/store/app-store";
import { useProject, useProjectApi } from "@/store/project-store";
import type { Invite, ProjectRole } from "@/lib/types";
import { Modal, Spinner } from "@/components/common/ui";

export function InviteDialog() {
  const open = useProject((s) => s.inviteOpen);
  const api = useProjectApi();
  const close = () => api.getState().setInviteOpen(false);
  return (
    <Modal open={open} onClose={close} label="Invite people">
      <Form onClose={close} />
    </Modal>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const api = useProjectApi();
  const app = useAppApi();
  const me = useApp((s) => s.me);
  const project = useProject((s) => s.project);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const email = String(f.get("email")).trim().toLowerCase();
        const role = String(f.get("role")) as ProjectRole;
        setError("");
        start(async () => {
          const r = await inviteMember(project.id, email, role);
          if (!r.ok) return setError(r.error);
          // Reload the real pending list (real ids, so Cancel / Resend work straight away).
          const { data } = await createClient()
            .from("project_invites")
            .select("*")
            .eq("project_id", project.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false });
          if (data) api.getState().setInvites(data as Invite[]);
          app.getState().toast({ text: `Invitation sent to ${email}`, tone: "success" });
          onClose();
        });
      }}
    >
      <header className="dlg-head">
        <h2>Invite to {project.name}</h2>
        <p className="sub">They get an e-mail from {me.full_name || "you"}. They join the project only after they accept.</p>
      </header>
      <div className="dlg-body">
      <label className="field">
        <span>E-mail address</span>
        <input type="email" name="email" required autoFocus placeholder="name@company.com" />
      </label>
      <label className="field">
        <span>Role in this project</span>
        <select name="role" defaultValue="developer">
          <option value="developer">Developer: works on tasks</option>
          <option value="tester">Tester: passes or fails testing</option>
          <option value="manager">Manager: approves reviews, manages the team</option>
        </select>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={pending}>{pending && <Spinner />} Send invitation</button>
      </div>
    </form>
  );
}
