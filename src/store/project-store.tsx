"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { withTransition } from "@/lib/motion";
import { describeMove } from "@/lib/workflow";
import type { Invite, Member, Priority, Project, ProjectRole, Task } from "@/lib/types";
import { useAppApi } from "./app-store";

export interface Filters {
  q: string;
  mine: boolean;
  priority: Priority | "all";
  allDone: boolean;
  declined: boolean;
  archived: boolean;
}

export interface ProjectInit {
  project: Project;
  me: { id: string; isAdmin: boolean; role: ProjectRole | null };
  members: Member[];
  tasks: Task[];
  invites: Invite[];
}

interface ProjectState extends ProjectInit {
  taskMap: Record<string, Task>;
  flash: Record<string, number>;
  filters: Filters;
  inviteOpen: boolean;
  /** Set once this project has been deleted, so live "member removed" events do not also fire. */
  gone: boolean;
  setGone: (g: boolean) => void;
  upsertTask: (t: Task, o?: { flash?: boolean; force?: boolean }) => void;
  removeTask: (id: string) => void;
  replaceTasks: (t: Task[]) => void;
  setMembers: (m: Member[]) => void;
  setInvites: (i: Invite[]) => void;
  setFilters: (f: Partial<Filters>) => void;
  setInviteOpen: (o: boolean) => void;
}

const Ctx = createContext<StoreApi<ProjectState> | null>(null);

const toMap = (list: Task[]) => Object.fromEntries(list.map((t) => [t.id, t]));

function makeStore(init: ProjectInit) {
  return createStore<ProjectState>((set) => ({
    ...init,
    taskMap: toMap(init.tasks),
    flash: {},
    filters: { q: "", mine: false, priority: "all", allDone: false, declined: false, archived: false },
    inviteOpen: false,
    gone: false,
    setGone: (gone) => set({ gone }),
    upsertTask: (t, o) =>
      set((s) => {
        const cur = s.taskMap[t.id];
        // Ignore echoes older than what we already show (our own optimistic update vs. a late event).
        if (cur && !o?.force && cur.updated_at > t.updated_at) return s;
        return {
          taskMap: { ...s.taskMap, [t.id]: t },
          flash: o?.flash ? { ...s.flash, [t.id]: (s.flash[t.id] ?? 0) + 1 } : s.flash,
        };
      }),
    removeTask: (id) =>
      set((s) => {
        const { [id]: _gone, ...rest } = s.taskMap;
        return { taskMap: rest };
      }),
    replaceTasks: (list) => set({ taskMap: toMap(list) }),
    setMembers: (members) => set({ members }),
    setInvites: (invites) => set({ invites }),
    setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
    setInviteOpen: (inviteOpen) => set({ inviteOpen }),
  }));
}

export function ProjectProvider({ init, children }: { init: ProjectInit; children: ReactNode }) {
  const [store] = useState(() => makeStore(init));
  const app = useAppApi();

  useEffect(() => {
    const sb = createClient();
    const { project, me } = store.getState();
    const isManager = me.isAdmin || me.role === "manager";
    let connectedBefore = false;

    const refetchTasks = async () => {
      const { data } = await sb.from("tasks").select("*").eq("project_id", project.id);
      if (data) store.getState().replaceTasks(data as Task[]);
    };
    const refetchMembers = async () => {
      if (store.getState().gone) return;
      let { data } = await sb
        .from("project_members")
        .select("*, profile:profiles(id,email,full_name,avatar_url)")
        .eq("project_id", project.id)
        .order("joined_at");
      if (!data) {
        ({ data } = await sb.from("project_members").select("*, profile:profiles(id,email,full_name)").eq("project_id", project.id).order("joined_at"));
      }
      if (!data) return;
      const list = data as unknown as Member[];
      store.getState().setMembers(list);
      if (!list.some((m) => m.user_id === me.id) && (!me.isAdmin || list.length === 0)) {
        const { data: still } = await sb.from("projects").select("id").eq("id", project.id).maybeSingle();
        if (!still || !me.isAdmin) {
          store.getState().setGone(true); // one notice only, even though every member row fires an event
          app.getState().toast({
            text: still ? "You were removed from this project." : `${project.name} was deleted by its creator.`,
            tone: "danger",
          });
          window.setTimeout(() => window.location.assign("/projects"), 900);
        }
      }
    };
    const refetchInvites = async () => {
      if (!isManager) return;
      const { data } = await sb
        .from("project_invites")
        .select("*")
        .eq("project_id", project.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (data) store.getState().setInvites(data as Invite[]);
    };

    const onTask = (task: Task) => {
      const s = store.getState();
      const prev = s.taskMap[task.id];
      const byOther = task.updated_by !== me.id;
      const moved = !!prev && (prev.status !== task.status || prev.position !== task.position);
      if (moved && byOther) withTransition(() => s.upsertTask(task, { flash: true }));
      else {
        // The work clock starting / stopping changes the row without touching updated_at: no flash for that.
        const timerOnly = !!prev && prev.status === task.status && prev.updated_at === task.updated_at;
        s.upsertTask(task, { flash: byOther && !timerOnly });
      }
      if (byOther && prev && prev.status !== task.status) {
        const who = s.members.find((m) => m.user_id === task.updated_by)?.profile.full_name ?? "Someone";
        const d = describeMove(prev.status, task.status, `${project.key}-${task.number}`);
        app.getState().toast({ text: `${who} ${d.text}`, tone: d.tone, href: `/projects/${project.id}?task=${task.id}` });
      }
    };

    const filter = `project_id=eq.${project.id}`;
    const ch = sb
      .channel(`project:${project.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter }, (p) => {
        if (p.eventType === "DELETE") store.getState().removeTask((p.old as { id: string }).id);
        else onTask(p.new as Task);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "project_members", filter }, refetchMembers)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_invites", filter }, refetchInvites)
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // After a dropped connection we may have missed events: resync everything once.
        if (connectedBefore) {
          refetchTasks();
          refetchMembers();
          refetchInvites();
        }
        connectedBefore = true;
      });

    // When I rename myself in Account settings, update my row in this project's team list too.
    let myName = app.getState().me.full_name;
    const unsubApp = app.subscribe(() => {
      const n = app.getState().me.full_name;
      if (n === myName) return;
      myName = n;
      const s = store.getState();
      s.setMembers(s.members.map((m) => (m.user_id === me.id ? { ...m, profile: { ...m.profile, full_name: n } } : m)));
    });

    const onVisible = () => document.visibilityState === "visible" && refetchTasks();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsubApp();
      sb.removeChannel(ch);
    };
  }, [store, app]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useProject<T>(selector: (s: ProjectState) => T): T {
  const s = useContext(Ctx);
  if (!s) throw new Error("useProject must be used inside ProjectProvider");
  return useStore(s, selector);
}

export function useProjectApi() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useProjectApi must be used inside ProjectProvider");
  return s;
}
