"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProject } from "@/app/actions";
import { navigateWithTransition } from "@/lib/nav";
import { useAppApi } from "@/store/app-store";
import { useProject, useProjectApi } from "@/store/project-store";
import { Icon, Modal, Spinner } from "@/components/common/ui";

/** Separate dialog for the one irreversible action: deleting the whole project. Creator only. */
export function DeleteProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Delete project" variant="alert">
      <Form onClose={onClose} />
    </Modal>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const app = useAppApi();
  const api = useProjectApi();
  const project = useProject((s) => s.project);
  const tasks = useProject((s) => Object.keys(s.taskMap).length);
  const members = useProject((s) => s.members.length);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const match = typed.trim().toUpperCase() === project.key;

  return (
    <form
      className="confirm delete-project"
      onSubmit={(e) => {
        e.preventDefault();
        if (!match) return;
        setError("");
        start(async () => {
          api.getState().setGone(true); // our own delete must not trigger the "you were removed" handler
          const r = await deleteProject(project.id, typed);
          if (!r.ok) {
            api.getState().setGone(false);
            return setError(r.error);
          }
          app.getState().toast({ text: `Project ${project.name} was deleted`, tone: "success" });
          onClose();
          if (!navigateWithTransition(router, "/projects", "page", "back")) router.push("/projects");
        });
      }}
    >
      <span className="confirm-ico" data-tone="danger" aria-hidden><Icon n="trash" size={22} /></span>
      <div className="confirm-text">
        <h2>Delete {project.name}?</h2>
        <p>
          This permanently deletes <b>{tasks} {tasks === 1 ? "task" : "tasks"}</b>, their history, pending invitations,
          and removes all <b>{members} {members === 1 ? "member" : "members"}</b>. It cannot be undone.
        </p>
      </div>
      <label className="field confirm-field">
        <span>Type <code>{project.key}</code> to confirm</span>
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder={project.key} />
      </label>
      {error && <p className="form-error confirm-field" role="alert">{error}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={!match || pending}>{pending && <Spinner />} Delete project</button>
      </div>
    </form>
  );
}
