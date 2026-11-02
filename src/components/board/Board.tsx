"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { archiveDone, deleteTask, reorderTask, setDecisionFiles, transitionTask } from "@/app/actions";
import { uploadFiles } from "@/lib/files";
import { createClient } from "@/lib/supabase/client";
import { withTransition } from "@/lib/motion";
import { useNow } from "@/lib/useNow";
import { COLUMNS, DECLINED_COLUMN, canManageProject, PRIORITIES, describeMove, movesFor, overrideMoves, whyNoMove, type Move, type MoveCtx } from "@/lib/workflow";
import type { Priority, Status, Task } from "@/lib/types";
import { useAppApi } from "@/store/app-store";
import { useProject, useProjectApi } from "@/store/project-store";
import { BoardCtx, type BoardActions } from "@/components/board/board-context";
import { NoteDialog } from "@/components/board/NoteDialog";
import { TaskCard } from "@/components/board/TaskCard";
import { TaskDrawer } from "@/components/board/TaskDrawer";
import { TaskFormDialog, type FormState } from "@/components/board/TaskForm";
import { Icon } from "@/components/common/ui";

const DONE_WINDOW_MS = 14 * 864e5;
/** Lanes whose order is set by hand (the others are ordered by date). */
const MANUAL: Status[] = ["todo", "in_progress", "on_hold", "in_review", "testing"];

export function Board() {
  const api = useProjectApi();
  const app = useAppApi();
  const project = useProject((s) => s.project);
  const me = useProject((s) => s.me);
  const members = useProject((s) => s.members);
  const taskMap = useProject((s) => s.taskMap);
  const flash = useProject((s) => s.flash);
  const filters = useProject((s) => s.filters);
  const setFilters = useProject((s) => s.setFilters);
  const now = useNow();

  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [pending, setPending] = useState<{ task: Task; move: Move; ref: string; pos?: number } | null>(null);
  const [drag, setDrag] = useState<Task | null>(null);
  const [dropAt, setDropAt] = useState<{ status: Status; index: number } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const ctx: MoveCtx = useMemo(
    () => ({
      userId: me.id,
      isManager: canManageProject(me.isAdmin, me.role),
      role: me.role,
      hasTesters: members.some((m) => m.role === "tester"),
      otherApprovers: members.filter((m) => m.role === "manager" && m.user_id !== me.id).length,
      otherTesters: members.filter((m) => m.role === "tester" && m.user_id !== me.id).length,
    }),
    [me, members],
  );

  // Links from e-mails and notifications look like /projects/<id>?task=<id>.
  const params = useSearchParams();
  const pathname = usePathname();
  const linked = params.get("task");
  useEffect(() => {
    if (!linked) return;
    window.history.replaceState(null, "", pathname);
    // Tasks are private: a link to one that was reassigned or is not yours leads nowhere.
    if (api.getState().taskMap[linked]) setOpenId(linked);
    else app.getState().toast({ text: "That task is not available to you any more.", tone: "info" });
  }, [linked, pathname, api, app]);

  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.profile.full_name])), [members]);
  const managerIds = useMemo(() => new Set(members.filter((m) => m.role === "manager").map((m) => m.user_id)), [members]);
  const photos = useMemo(() => new Map(members.map((m) => [m.user_id, m.profile.avatar_url])), [members]);
  const ref = useCallback((t: Task) => `${project.key}-${t.number}`, [project.key]);

  /* ------------------------------------------------------------ moving cards */
  const run = useCallback(
    async (task: Task, move: Move, note?: string, pos?: number, files: File[] = []) => {
      const s = api.getState();
      const label = ref(task);
      // Starting work parks my other In-progress cards on hold (the database does the same, atomically).
      const parked: Task[] =
        move.to === "in_progress" && (task.assignee_id ?? me.id) === me.id
          ? Object.values(api.getState().taskMap).filter((o) => o.id !== task.id && o.assignee_id === me.id && o.status === "in_progress")
          : [];
      // Close the drawer so the card visibly travels to its new column.
      setOpenId((cur) => (cur === task.id ? null : cur));
      // Optimistic: the card moves instantly (animated); the database has the final say.
      withTransition(() =>
        s.upsertTask(
          {
            ...task,
            status: move.to,
            last_decision_files: [],
            position: pos ?? Date.now(),
            assignee_id: task.assignee_id ?? (move.kind === "start" ? me.id : null),
            last_decision_note:
              (move.to === "in_progress" || move.to === "declined" || (move.to === "todo" && move.kind === "reject")) && note
                ? note
                : move.to === "in_progress" || move.to === "on_hold" || move.kind === "pause"
                  ? task.last_decision_note
                  : null,
          },
          { force: true },
        ),
      );
      if (parked.length) {
        withTransition(() => parked.forEach((o) => api.getState().upsertTask({ ...o, status: "on_hold", position: Date.now() }, { force: true })));
      }
      const r = await transitionTask(task.id, task.status, move.to, note, move.kind === "override");
      if (r.ok) {
        s.upsertTask(r.data, { force: true });
        // Dropped on a specific spot: remember it (managers only; the server enforces this).
        if (pos != null && ctx.isManager) {
          const o = await reorderTask(task.id, pos);
          if (o.ok) s.upsertTask(o.data, { force: true });
        }
        // Photos / PDFs for the remark: upload, then attach them to the card.
        if (files.length) {
          try {
            const stored = await uploadFiles(task.project_id, task.id, files);
            const a = await setDecisionFiles(task.id, stored);
            if (a.ok) s.upsertTask(a.data, { force: true });
            else app.getState().toast({ text: `Moved, but the files were not attached: ${a.error}`, tone: "danger" });
          } catch (err) {
            app.getState().toast({ text: err instanceof Error ? err.message : "The files could not be uploaded", tone: "danger" });
          }
        }
        const d = describeMove(task.status, move.to, label);
        app.getState().toast({ text: `You ${d.text}`, tone: d.tone === "danger" ? "info" : d.tone });
        if (parked.length) {
          app.getState().toast({ text: `${parked.map(ref).join(", ")} moved to On hold. Only one task runs at a time.`, tone: "info" });
        }
      } else {
        app.getState().toast({ text: r.error, tone: "danger" });
        // Never trust the optimistic copy or the old snapshot: show what the database actually says.
        const { data } = await createClient().from("tasks").select("*").eq("id", task.id).maybeSingle();
        withTransition(() => {
          s.upsertTask((data as Task | null) ?? task, { force: true });
          parked.forEach((o) => s.upsertTask(o, { force: true }));
        });
      }
    },
    [api, app, me.id, ref, ctx.isManager],
  );

  const requestMove = useCallback(
    (task: Task, move: Move, pos?: number) => {
      if (move.kind === "approve_proposal") setForm({ mode: "review", task }); // manager adjusts details, then approves
      else if (move.note === "required") setPending({ task, move, ref: ref(task), pos });
      else void run(task, move, undefined, pos);
    },
    [ref, run],
  );

  /** Put a card at a new spot in the lane it is already in. */
  const reorder = useCallback(
    async (task: Task, pos: number) => {
      const s = api.getState();
      withTransition(() => s.upsertTask({ ...task, position: pos }, { force: true }));
      const r = await reorderTask(task.id, pos);
      if (r.ok) s.upsertTask(r.data, { force: true });
      else {
        app.getState().toast({ text: r.error, tone: "danger" });
        withTransition(() => s.upsertTask(task, { force: true }));
      }
    },
    [api, app],
  );

  const remove = useCallback(
    async (task: Task) => {
      const withdraw = !ctx.isManager;
      const ok = await app.getState().ask({
        title: withdraw ? `Withdraw ${ref(task)}?` : `Delete ${ref(task)}?`,
        body: withdraw ? "The proposal is removed for everyone." : "This removes the task and its history for everyone. It cannot be undone.",
        confirmLabel: withdraw ? "Withdraw" : "Delete task",
        tone: "danger",
      });
      if (!ok) return;
      const r = await deleteTask(task.id);
      if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
      withTransition(() => api.getState().removeTask(task.id));
      setOpenId(null);
      app.getState().toast({ text: `${ref(task)} ${withdraw ? "withdrawn" : "deleted"}`, tone: "info" });
    },
    [api, app, ref, ctx.isManager],
  );

  const actions: BoardActions = useMemo(
    () => ({
      ctx,
      canCreate: true,
      open: setOpenId,
      requestMove,
      edit: (task) => setForm({ mode: "edit", task }),
      review: (task) => setForm({ mode: "review", task }),
      remove,
    }),
    [ctx, requestMove, remove],
  );

  /* -------------------------------------------------------------- filtering */
  const columns = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const out: Record<Status, Task[]> = { proposed: [], declined: [], todo: [], in_progress: [], on_hold: [], in_review: [], testing: [], done: [] };
    let hiddenDone = 0;
    let archived = 0;
    for (const t of Object.values(taskMap)) {
      if (filters.mine && t.assignee_id !== me.id) continue;
      if (filters.priority !== "all" && t.priority !== filters.priority) continue;
      if (q && !t.title.toLowerCase().includes(q) && !`${project.key}-${t.number}`.toLowerCase().includes(q)) continue;
      if (t.archived_at) {
        archived++;
        if (filters.archived) out.done.push(t);
        continue;
      }
      if (t.status === "done" && !filters.allDone && t.completed_at && now && now - new Date(t.completed_at).getTime() > DONE_WINDOW_MS) {
        hiddenDone++;
        continue;
      }
      out[t.status].push(t);
    }
    for (const c of [...COLUMNS, DECLINED_COLUMN]) {
      out[c.id].sort(
        c.id === "done"
          ? (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
          : c.id === "proposed" || c.id === "declined"
            ? (a, b) => a.created_at.localeCompare(b.created_at)
            : (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
      );
    }
    return { out, hiddenDone, archived };
  }, [taskMap, filters, me.id, project.key, now]);

  /** Completed tasks that are not archived yet (what "Archive all" would move off the board). */
  const doneOpen = useMemo(() => Object.values(taskMap).filter((t) => t.status === "done" && !t.archived_at).length, [taskMap]);

  const archiveAll = async () => {
    const ok = await app.getState().ask({
      title: "Archive completed tasks?",
      body: `${doneOpen} completed ${doneOpen === 1 ? "task leaves" : "tasks leave"} the board. They stay searchable under "Archived" and can be restored.`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    const r = await archiveDone(project.id);
    if (!r.ok) return app.getState().toast({ text: r.error, tone: "danger" });
    withTransition(() => r.data.forEach((t) => api.getState().upsertTask(t, { force: true })));
    app.getState().toast({ text: `${r.data.length} ${r.data.length === 1 ? "task" : "tasks"} archived`, tone: "success" });
  };

  const valid = useMemo(() => (drag ? new Set(movesFor(drag, ctx).map((m) => m.to)) : null), [drag, ctx]);
  const override = useMemo(() => (drag ? new Set(overrideMoves(drag, ctx).map((m) => m.to)) : null), [drag, ctx]);

  const canReorder = (t: Task) => ctx.isManager && MANUAL.includes(t.status);

  /** Where would a card dropped at this cursor position land? Index among the other cards in the lane. */
  const indexAt = (e: React.DragEvent<HTMLElement>) => {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".card:not([data-dragging=\"true\"])"));
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  };

  /** Sort key that puts a card at `index` among the lane's other cards. */
  const positionFor = (to: Status, index: number, id: string) => {
    if (!MANUAL.includes(to)) return undefined;
    const others = columns.out[to].filter((x) => x.id !== id);
    if (others.length === 0) return undefined;
    if (index <= 0) return others[0]!.position - 1000;
    if (index >= others.length) return others[others.length - 1]!.position + 1000;
    return (others[index - 1]!.position + others[index]!.position) / 2;
  };

  const drop = (to: Status, index: number) => {
    const t = drag;
    setDrag(null);
    setDropAt(null);
    if (!t) return;
    if (t.status === to) {
      if (canReorder(t)) {
        const pos = positionFor(to, index, t.id);
        if (pos != null) void reorder(t, pos);
      }
      return;
    }
    const move = movesFor(t, ctx).find((m) => m.to === to) ?? overrideMoves(t, ctx).find((m) => m.to === to);
    if (!move) {
      const why =
        to === "proposed" || to === "declined"
          ? "Proposals are only approved or declined by a manager."
          : t.status === "in_review" && ctx.isManager && t.requires_testing && to === "done"
            ? "This task needs testing. Approve it to send it to testing first."
            : whyNoMove(t, ctx);
      return app.getState().toast({ text: why, tone: "danger" });
    }
    requestMove(t, move, ctx.isManager ? positionFor(to, index, t.id) : undefined);
  };

  return (
    <BoardCtx.Provider value={actions}>
      <div className="toolbar" role="search">
        <label className="search">
          <Icon n="search" size={14} />
          <input type="search" placeholder="Search tasks" aria-label="Search tasks" value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.mine} onChange={(e) => withTransition(() => setFilters({ mine: e.target.checked }))} />
          <span>My tasks</span>
        </label>
        <select aria-label="Priority" value={filters.priority} onChange={(e) => withTransition(() => setFilters({ priority: e.target.value as Priority | "all" }))}>
          <option value="all">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {columns.hiddenDone > 0 || filters.allDone ? (
          <label className="check">
            <input type="checkbox" checked={filters.allDone} onChange={(e) => withTransition(() => setFilters({ allDone: e.target.checked }))} />
            <span>All completed{columns.hiddenDone > 0 ? ` (+${columns.hiddenDone})` : ""}</span>
          </label>
        ) : null}
        {columns.archived > 0 || filters.archived ? (
          <label className="check">
            <input type="checkbox" checked={filters.archived} onChange={(e) => withTransition(() => setFilters({ archived: e.target.checked }))} />
            <span>Archived ({columns.archived})</span>
          </label>
        ) : null}
        {columns.out.declined.length > 0 || filters.declined ? (
          <label className="check">
            <input type="checkbox" checked={filters.declined} onChange={(e) => withTransition(() => setFilters({ declined: e.target.checked }))} />
            <span>Declined ({columns.out.declined.length})</span>
          </label>
        ) : null}
        <button className="btn primary spacer" onClick={() => setForm({ mode: "create" })}>
          <Icon n={ctx.isManager ? "plus" : "inbox"} /> {ctx.isManager ? "Create task" : "Propose task"}
        </button>
      </div>

      <div className="board" data-dragging={!!drag} data-ready={ready} onDragEnd={() => { setDrag(null); setDropAt(null); }}>
        {(filters.declined ? [...COLUMNS, DECLINED_COLUMN] : COLUMNS).map((c) => {
          const list = columns.out[c.id];
          const state = !drag ? undefined : drag.status === c.id ? (canReorder(drag) ? "valid" : "self") : valid?.has(c.id) ? "valid" : override?.has(c.id) ? "override" : "invalid";
          const hint = c.id === "proposed" && !ctx.isManager ? "Your ideas land here until a manager approves" : c.hint;
          return (
            <section
              key={c.id}
              className="col"
              data-status={c.id}
              data-drop={state}
              aria-label={`${c.label}, ${list.length} tasks`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const ok = state === "valid" || state === "override";
                const index = ok ? indexAt(e) : -1;
                if (!ok) return dropAt && setDropAt(null);
                if (dropAt?.status !== c.id || dropAt.index !== index) setDropAt({ status: c.id, index });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt((cur) => (cur?.status === c.id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(c.id, dropAt?.status === c.id ? dropAt.index : Number.MAX_SAFE_INTEGER);
              }}
            >
              <header className="col-head">
                <h2>{c.label}</h2>
                <span className="count" key={`n-${list.length}`}>{list.length}</span>
                {c.id === "done" && ctx.isManager && doneOpen > 0 && (
                  <button type="button" className="btn subtle sm col-action" title="Move every completed task off the board" onClick={() => void archiveAll()}>
                    <Icon n="archive" size={12} /> Archive all
                  </button>
                )}
              </header>
              <p className="col-hint">{hint}</p>
              <div className="col-body">
                {list.length === 0 && (
                  <p className="col-empty">{filters.q || filters.mine || filters.priority !== "all" ? "No matches" : "Nothing here yet"}</p>
                )}
                {(() => {
                  let n = 0;
                  const line = <div className="drop-line" key="drop-line" aria-hidden />;
                  const out = list.map((t, i) => {
                    const isDragged = drag?.id === t.id;
                    const showLine = dropAt?.status === c.id && !isDragged && n === dropAt.index;
                    if (!isDragged) n++;
                    return (
                      <Fragment key={t.id}>
                        {showLine && line}
                        <TaskCard
                          key={`${t.id}:${flash[t.id] ?? 0}`}
                          task={t}
                          index={i}
                          refKey={ref(t)}
                          assignee={t.assignee_id ? names.get(t.assignee_id) : undefined}
                          assigneePhoto={t.assignee_id ? photos.get(t.assignee_id) : undefined}
                          proposer={t.reporter_id ? names.get(t.reporter_id) : undefined}
                          managerOnly={ctx.isManager && !!t.assignee_id && managerIds.has(t.assignee_id)}
                          now={now}
                          flash={flash[t.id] ?? 0}
                          draggable={movesFor(t, ctx).length > 0 || overrideMoves(t, ctx).length > 0 || canReorder(t)}
                          dragging={isDragged}
                          onOpen={() => setOpenId(t.id)}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", t.id);
                            setDrag(t);
                          }}
                          onDragEnd={() => { setDrag(null); setDropAt(null); }}
                        />
                      </Fragment>
                    );
                  });
                  if (dropAt?.status === c.id && dropAt.index >= n) out.push(line);
                  return out;
                })()}
              </div>
            </section>
          );
        })}
      </div>

      <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />
      <TaskFormDialog state={form} onClose={() => setForm(null)} />
      <NoteDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={(note, files) => {
          if (!pending) return;
          const { task, move, pos } = pending;
          setPending(null);
          void run(task, move, note, pos, files);
        }}
      />
    </BoardCtx.Provider>
  );
}
