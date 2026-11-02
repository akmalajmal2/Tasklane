"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { MyInvite, Notice, Profile } from "@/lib/types";

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "success" | "danger";
  href?: string | null;
}

export interface AskOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}

interface AppState {
  me: Profile;
  /** The in-app confirmation dialog currently on screen, if any. */
  ask: (o: AskOptions) => Promise<boolean>;
  asking: AskOptions | null;
  answer: (ok: boolean) => void;
  notices: Notice[];
  /** Invitations waiting for this user. Kept live, so Accept / Decline appear without a reload. */
  invites: MyInvite[];
  setInvites: (i: MyInvite[]) => void;
  dropInvite: (token: string) => void;
  toasts: Toast[];
  addNotice: (n: Notice) => void;
  mergeNotices: (list: Notice[]) => void;
  patchNotice: (n: Notice) => void;
  markRead: (ids: string[] | "all") => void;
  /** Delete notifications for good ("all" empties the whole inbox, including ones not loaded here). */
  clearNotices: (ids: string[] | "all") => void;
  /** Remove from this tab only (the row is already gone in the database). */
  dropNotices: (ids: string[]) => void;
  setMe: (p: Partial<Profile>) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<StoreApi<AppState> | null>(null);

const TONE: Record<string, Toast["tone"]> = {
  proposal_approved: "success", approved: "success", test_passed: "success", invite_accepted: "success",
  proposal_declined: "danger", rejected: "danger", test_failed: "danger", overdue: "danger",
};

function makeStore(me: Profile, notices: Notice[], invites: MyInvite[]) {
  let resolver: ((ok: boolean) => void) | null = null;
  // Ids the user just cleared: a refetch that was already in flight must not bring them back.
  const removed = new Set<string>();
  return createStore<AppState>((set, get) => ({
    me,
    setMe: (p) => set((s) => ({ me: { ...s.me, ...p } })),
    asking: null,
    ask: (o) =>
      new Promise<boolean>((resolve) => {
        resolver?.(false); // a newer question replaces an unanswered one
        resolver = resolve;
        set({ asking: o });
      }),
    answer: (ok) => {
      const r = resolver;
      resolver = null;
      set({ asking: null });
      r?.(ok);
    },
    notices,
    invites,
    setInvites: (invites) => set({ invites }),
    dropInvite: (token) => set((s) => ({ invites: s.invites.filter((i) => i.token !== token) })),
    toasts: [],
    addNotice: (n) => set((s) => (s.notices.some((x) => x.id === n.id) || removed.has(n.id) ? s : { notices: [n, ...s.notices].slice(0, 50) })),
    // Used after a reconnect / tab wake-up: keep local read state, add anything we missed.
    mergeNotices: (list) =>
      set((s) => {
        const known = new Map(s.notices.map((n) => [n.id, n]));
        for (const n of list) if (!removed.has(n.id)) known.set(n.id, { ...n, read_at: n.read_at ?? known.get(n.id)?.read_at ?? null });
        return { notices: [...known.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50) };
      }),
    patchNotice: (n) => set((s) => ({ notices: s.notices.map((x) => (x.id === n.id ? n : x)) })),
    markRead: (ids) => {
      const at = new Date().toISOString();
      set((s) => ({ notices: s.notices.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)) }));
      // Persist in the background (RLS only lets a user touch their own rows).
      const q = createClient().from("notifications").update({ read_at: at }).is("read_at", null);
      void (ids === "all" ? q : q.in("id", ids));
    },
    dropNotices: (ids) => set((s) => ({ notices: s.notices.filter((n) => !ids.includes(n.id)) })),
    clearNotices: (ids) => {
      const before = get().notices;
      const target = ids === "all" ? before.map((n) => n.id) : ids;
      if (!target.length) return;
      target.forEach((id) => removed.add(id));
      set((s) => ({ notices: s.notices.filter((n) => !target.includes(n.id)) }));
      void createClient()
        .rpc("clear_notifications", { p_ids: ids === "all" ? null : ids })
        .then(({ error }) => {
          if (!error) return;
          // Put them back and say so: nothing was deleted.
          target.forEach((id) => removed.delete(id));
          set((s) => ({
            notices: [...before.filter((n) => target.includes(n.id)), ...s.notices]
              .filter((n, i, all) => all.findIndex((x) => x.id === n.id) === i)
              .sort((a, b) => b.created_at.localeCompare(a.created_at)),
          }));
          get().toast({ text: "Couldn't clear notifications. Try again.", tone: "danger" });
        });
    },
    toast: (t) => set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: Math.random().toString(36).slice(2) }] })),
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }));
}

export function AppProvider({ me, notices, invites, children }: { me: Profile; notices: Notice[]; invites: MyInvite[]; children: ReactNode }) {
  const [store] = useState(() => makeStore(me, notices, invites));

  // Live notifications: a new row for this user appears instantly, in every open tab.
  useEffect(() => {
    const sb = createClient();
    const resync = async () => {
      const { data } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
      if (data) store.getState().mergeNotices(data as Notice[]);
    };
    const refreshInvites = async () => {
      const { data } = await sb.rpc("my_invites");
      if (Array.isArray(data)) store.getState().setInvites(data as MyInvite[]);
    };
    const syncAll = () => {
      void resync();
      void refreshInvites();
    };
    const onVisible = () => document.visibilityState === "visible" && syncAll();
    document.addEventListener("visibilitychange", onVisible);

    // Is the realtime socket up? While it is, a slow poll is only a safety net; while it is not
    // (blocked network, table missing from the realtime publication, expired token) poll every 5 s.
    let live = false;
    let dead = false;
    let tick = 0;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      tick++;
      if (!live || tick % 6 === 0) syncAll();
    }, 5000);

    let ch: ReturnType<typeof sb.channel> | null = null;
    let retry: number | undefined;
    let attempt = 0;
    const connect = async () => {
      if (dead) return;
      // Realtime applies row-level security with the signed-in user's token: make sure it has it.
      const { data: sess } = await sb.auth.getSession();
      if (sess.session) sb.realtime.setAuth(sess.session.access_token);
      if (dead) return;
      ch = sb
        .channel(`notices:${me.id}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, (p) => {
          const n = p.new as Notice;
          const s = store.getState();
          if (s.notices.some((x) => x.id === n.id)) return;
          s.addNotice(n);
          if (n.kind === "invite_received") void refreshInvites();
          s.toast({ text: n.title, tone: TONE[n.kind] ?? "info", href: n.link });
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, (p) =>
          store.getState().patchNotice(p.new as Notice),
        )
        // Cleared in another tab. (Delete events cannot be filtered; ids that are not ours are simply ignored.)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications" }, (p) => {
          const id = (p.old as { id?: string }).id;
          if (id) store.getState().dropNotices([id]);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            live = true;
            attempt = 0;
            syncAll(); // anything that happened while connecting or after a dropped connection
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            live = false;
            if (dead) return;
            // Start over with a fresh channel, a little slower each time (2 s up to 30 s).
            const old = ch;
            ch = null;
            if (old) void sb.removeChannel(old);
            window.clearTimeout(retry);
            retry = window.setTimeout(() => void connect(), Math.min(30000, 2000 * 2 ** attempt++));
          }
        });
    };
    void connect();
    syncAll();
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
      window.clearTimeout(retry);
      if (ch) void sb.removeChannel(ch);
    };
  }, [me.id, store]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const s = useContext(Ctx);
  if (!s) throw new Error("useApp must be used inside AppProvider");
  return useStore(s, selector);
}

export function useAppApi() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useAppApi must be used inside AppProvider");
  return s;
}
