"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPT, MAX_FILES, fileProblem, fmtSize, isImage } from "@/lib/files";
import type { Task } from "@/lib/types";
import type { Move } from "@/lib/workflow";
import { Icon, Modal } from "@/components/common/ui";

const COPY: Record<string, { title: string; ask: string; cta: string }> = {
  reject: { title: "Send back for changes", ask: "What needs to change?", cta: "Send back" },
  fail: { title: "Fail testing", ask: "What failed? Steps to reproduce help.", cta: "Fail testing" },
  reopen: { title: "Reopen task", ask: "Why is this being reopened?", cta: "Reopen" },
  decline: { title: "Decline proposal", ask: "Why is it declined? The proposer can revise and resubmit.", cta: "Decline" },
  override: { title: "Move outside the workflow", ask: "Reason for the manual move. It is logged and the assignee is told.", cta: "Move card" },
};

type Pending = { task: Task; move: Move; ref: string };

export function NoteDialog({
  pending, onCancel, onConfirm,
}: {
  pending: Pending | null;
  onCancel: () => void;
  onConfirm: (note: string, files: File[]) => void;
}) {
  return (
    <Modal open={!!pending} onClose={onCancel} label="Add a note">
      {pending && <Body p={pending} onCancel={onCancel} onConfirm={onConfirm} />}
    </Modal>
  );
}

function Body({ p, onCancel, onConfirm }: { p: Pending; onCancel: () => void; onConfirm: (n: string, f: File[]) => void }) {
  const copy = COPY[p.move.kind] ?? COPY.reject!;
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    let msg = "";
    for (const f of Array.from(list)) {
      const bad = fileProblem(f);
      if (bad) msg = bad;
      else if (next.length >= MAX_FILES) msg = `You can attach up to ${MAX_FILES} files`;
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
    setProblem(msg);
  };

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(note.trim(), files);
      }}
    >
      <header className="dlg-head">
        <h2>{copy.title}</h2>
        <p className="sub">{p.ref} · {p.task.title}</p>
      </header>

      <div className="dlg-body">
        <label className="field">
          <span>{copy.ask}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} autoFocus rows={4} />
        </label>

        <div className="field">
          <span>Attach photos or PDFs <em className="opt">optional</em></span>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
          >
            <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={files.length >= MAX_FILES}>
              <Icon n="paperclip" size={14} /> Choose files
            </button>
            <small>or drop them here · up to {MAX_FILES} files, 5 MB each</small>
            <input ref={input} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </div>
          {problem && <small className="file-problem" role="alert">{problem}</small>}
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f) => (
                <FileRow key={`${f.name}-${f.size}`} file={f} onRemove={() => setFiles(files.filter((x) => x !== f))} />
              ))}
            </ul>
          )}
        </div>
        <small className="hint">The person concerned gets this in their notification and e-mail.</small>
      </div>

      <div className="dlg-actions">
        <button type="button" className="btn subtle" onClick={onCancel}>Cancel</button>
        <button className={`btn ${p.move.tone === "danger" ? "danger" : "primary"}`} disabled={note.trim().length < 3}>{copy.cta}</button>
      </div>
    </form>
  );
}

function FileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => (isImage(file.type) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <li className="file-row">
      {url ? <img src={url} alt="" className="file-thumb" /> : <span className="file-thumb"><Icon n="file" size={18} /></span>}
      <span className="file-meta"><b>{file.name}</b><small>{fmtSize(file.size)}</small></span>
      <button type="button" className="icon-btn" aria-label={`Remove ${file.name}`} onClick={onRemove}><Icon n="x" size={14} /></button>
    </li>
  );
}
