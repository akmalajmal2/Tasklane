"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { addComment, deleteComment } from "@/app/actions";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { TaskComment } from "@/lib/types";
import { useApp, useAppApi } from "@/store/app-store";
import { useProject } from "@/store/project-store";
import { Avatar, Icon, Spinner } from "./ui";

const MAX = 2000;

/** Discussion on one task. New comments from teammates appear live; the author or a manager can delete one. */
export function TaskComments({ taskId }: { taskId: string }) {
  const app = useAppApi();
  const meId = useApp((s) => s.me.id);
  const isManager = useProject((s) => s.me.isAdmin || s.me.role === "manager");
  const [list, setList] = useState<TaskComment[] | null>(null);
  /** The comments table is missing from this database (migration v11 not run): stop asking for it. */
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("task_comments")
      .select("*, author:profiles(full_name)")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error && (error.code === "PGRST205" || error.code === "42P01" || /task_comments/.test(error.message))) return setMissing(true);
    if (data) setList(data as unknown as TaskComment[]);
  }, [taskId]);

  useEffect(() => {
    if (missing) return;
    void load();
    const sb = createClient();
    const ch = sb
      .channel(`comments:${taskId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` }, () => void load())
      // Delete events cannot be filtered; ids that are not in this list are ignored.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_comments" }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) setList((l) => (l ? l.filter((c) => c.id !== id) : l));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load(); // catch anything posted while connecting
      });
    return () => {
      void sb.removeChannel(ch);
    };
  }, [taskId, load, missing]);

  const post = () => {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const r = await addComment(taskId, body);
      if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
      setText("");
      await load();
    });
  };

  const remove = async (c: TaskComment) => {
    const ok = await app.getState().ask({ title: "Delete this comment?", body: "It is removed for everyone.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    const r = await deleteComment(c.id);
    if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
    setList((l) => (l ? l.filter((x) => x.id !== c.id) : l));
  };

  if (missing) {
    return (
      <section className="d-block" aria-label="Comments">
        <h3 className="legend" style={{ marginBottom: 10 }}>Comments</h3>
        <p style={{ color: "var(--ink-3)" }}>Comments are not set up in this database yet. Run <code>supabase/migration-v11-comments-prefs-archive.sql</code> in the Supabase SQL Editor, then reload.</p>
      </section>
    );
  }

  return (
    <section className="d-block" aria-label="Comments">
      <h3 className="legend" style={{ marginBottom: 10 }}>Comments{list && list.length > 0 ? ` (${list.length})` : ""}</h3>
      {list === null ? null : list.length === 0 ? (
        <p style={{ color: "var(--ink-3)", marginBottom: 10 }}>No comments yet. Start the conversation.</p>
      ) : (
        <ul className="comments">
          {list.map((c) => {
            const name = c.author?.full_name ?? "Former member";
            return (
              <li key={c.id}>
                <Avatar name={name} size={26} />
                <div className="c-body">
                  <div className="c-head">
                    <b>{name}</b>
                    <time suppressHydrationWarning>{fmtDateTime(c.created_at)}</time>
                    {(c.author_id === meId || isManager) && (
                      <button type="button" className="icon-btn c-del" aria-label="Delete comment" title="Delete" onClick={() => void remove(c)}>
                        <Icon n="trash" size={14} />
                      </button>
                    )}
                  </div>
                  <p>{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="comment-box">
        <textarea
          value={text}
          maxLength={MAX}
          rows={2}
          placeholder="Write a comment…"
          aria-label="Write a comment"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              post();
            }
          }}
        />
        <button type="button" className="btn primary sm" disabled={pending || !text.trim()} onClick={post}>
          {pending ? <Spinner /> : <Icon n="comment" size={14} />} Post
        </button>
      </div>
    </section>
  );
}
