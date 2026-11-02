"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/app/actions";
import { navigateWithTransition } from "@/lib/nav";
import { Icon, Modal, Spinner } from "@/components/common/ui";

export function NewProject() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        <Icon n="plus" /> New project
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="New project">
        <Form onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);

  const suggest = (name: string) =>
    name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await createProject({ key, name: String(f.get("name")), description: String(f.get("description") ?? "") });
          if (!r.ok) return setError(r.error);
          const to = `/projects/${r.data.id}`;
          if (!navigateWithTransition(router, to)) router.push(to);
          onClose();
        });
      }}
    >
      <header className="dlg-head">
        <h2>New project</h2>
        <p className="sub">You become its manager and can invite the rest of the team.</p>
      </header>
      <div className="dlg-body">
      <label className="field">
        <span>Name</span>
        <input type="text" name="name" required minLength={2} maxLength={80} autoFocus onChange={(e) => !keyTouched && setKey(suggest(e.target.value))} />
      </label>
      <label className="field">
        <span>Key</span>
        <input
          type="text"
          value={key}
          required
          pattern="[A-Z][A-Z0-9]{1,5}"
          maxLength={6}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value.toUpperCase());
          }}
        />
        <small>2–6 letters or digits. Tasks are numbered like {key || "KEY"}-1.</small>
      </label>
      <label className="field">
        <span>Description</span>
        <textarea name="description" rows={3} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={pending}>{pending && <Spinner />} Create project</button>
      </div>
    </form>
  );
}
