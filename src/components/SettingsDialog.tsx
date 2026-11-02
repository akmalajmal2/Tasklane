"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { updateAvatar, updateProfile } from "@/app/actions";
import { EMAIL_GROUPS } from "@/lib/prefs";
import { useApp, useAppApi } from "@/store/app-store";
import { PhotoCapture } from "./PhotoCapture";
import { Avatar, Modal, Spinner } from "./ui";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Account settings">
      <Form onClose={onClose} />
    </Modal>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const app = useAppApi();
  const me = useApp((s) => s.me);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [retaking, setRetaking] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const savePhoto = async (photo: string | null) => {
    if (!photo) return;
    setSavingPhoto(true);
    const r = await updateAvatar(photo);
    setSavingPhoto(false);
    if (!r.ok) return setError(r.error);
    app.getState().setMe({ avatar_url: r.data });
    app.getState().toast({ text: "Profile photo updated", tone: "success" });
    setRetaking(false);
  };

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const name = String(f.get("name") ?? "").trim();
        if (!name) return setError("Enter your name.");
        const on = new Set(f.getAll("mail").map(String));
        const muted = EMAIL_GROUPS.map((g) => g.id).filter((id) => !on.has(id));
        setError("");
        start(async () => {
          const r = await updateProfile(name, muted);
          if (!r.ok) return setError(r.error);
          app.getState().setMe({ full_name: r.data.full_name, mute_email: r.data.mute_email });
          app.getState().toast({ text: "Settings saved", tone: "success" });
          onClose();
        });
      }}
    >
      <header className="dlg-head">
        <h2>Account settings</h2>
        <p className="sub">{me.email}</p>
      </header>
      <div className="dlg-body">
        <div className="field">
          <span>Profile photo</span>
          {retaking ? (
            <>
              <PhotoCapture value={null} onChange={(v) => void savePhoto(v)} />
              <button type="button" className="btn subtle sm" onClick={() => setRetaking(false)} disabled={savingPhoto}>Cancel</button>
            </>
          ) : (
            <div className="photo">
              <Avatar name={me.full_name || me.email} size={64} src={me.avatar_url} />
              <button type="button" className="btn sm" onClick={() => setRetaking(true)}>{me.avatar_url ? "Retake photo" : "Add photo"}</button>
            </div>
          )}
        </div>

        <label className="field">
          <span>Your name</span>
          <input type="text" name="name" required maxLength={80} defaultValue={me.full_name} autoComplete="name" />
          <small>Shown to your teammates on tasks, comments and the team list.</small>
        </label>

        <fieldset className="mail-prefs">
          <legend>E-mail me about</legend>
          {EMAIL_GROUPS.map((g) => (
            <label className="pref" key={g.id}>
              <input type="checkbox" name="mail" value={g.id} defaultChecked={!me.mute_email.includes(g.id)} />
              <span>
                {g.label}
                <small>{g.hint}</small>
              </span>
            </label>
          ))}
          <small>Everything still appears in the bell. Project invitations are always e-mailed.</small>
        </fieldset>

        <p>
          <Link href="/auth/reset" onClick={onClose}>Change password</Link>
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={pending}>{pending && <Spinner />} Save</button>
      </div>
    </form>
  );
}
