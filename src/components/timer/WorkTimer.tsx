"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AWAY_MS, HEARTBEAT_MS, IDLE_MS, PAUSE_LABEL, RESUME_FRAMES, SLEEP_GAP_MS, START_GRACE_MS, TASK_MOVED, elapsedSeconds, fmtClock } from "@/lib/timer";
import { grabFrame, idleCtor, idlePermission, loadFaceMatcher, steadyInterval, type FaceMatcher, type IdleDetectorLike } from "@/lib/presence";
import type { Task } from "@/lib/types";
import { useApp } from "@/store/app-store";
import { Icon } from "@/components/common/ui";

type ActiveTask = Task & { project: { key: string } | null };
/** "idle" = the camera is switched off on purpose because the computer is idle or the screen is locked. */
type Cam = "starting" | "on" | "denied" | "error" | "idle";
type Model = "loading" | "ready" | "error";
type IdleSupport = "unsupported" | "needs-permission" | "on" | "denied";

/**
 * Runs the work clock for the signed-in person's In-progress task.
 * The camera is only on while such a task exists. It does not ask "is somebody there?" but
 * "is the person captured at account setup there?": every camera frame is compared with the profile photo.
 * The clock stops when
 *   - that person is not seen for a few seconds (nobody there, or somebody else),
 *   - the computer is idle (no keyboard / mouse anywhere) or the screen is locked (Chrome / Edge),
 *   - the computer slept, or the camera is unavailable,
 * and starts again by itself when the account holder is back.
 */
export function WorkTimer() {
  const meId = useApp((s) => s.me.id);
  const avatar = useApp((s) => s.me.avatar_url);
  const [task, setTask] = useState<ActiveTask | null>(null);
  const [cam, setCam] = useState<Cam>("starting");
  const [model, setModel] = useState<Model>("loading");
  const [enrolled, setEnrolled] = useState(true);
  const [idleSupport, setIdleSupport] = useState<IdleSupport>("unsupported");
  const [camTry, setCamTry] = useState(0);
  /** The computer is idle or locked: the camera is off until someone is back. */
  const [camPaused, setCamPaused] = useState(false);
  const [modelTry, setModelTry] = useState(0);
  const [now, setNow] = useState(0);

  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const matcher = useRef<FaceMatcher | null>(null);
  const taskRef = useRef<ActiveTask | null>(null);
  const camRef = useRef<Cam>("starting");
  const running = useRef(false);
  const inflight = useRef(false);
  const lastSeen = useRef(0);
  const streak = useRef(0);
  /** The last face the camera saw was not the account holder. */
  const stranger = useRef(false);
  const asleep = useRef(false);
  const lastBeat = useRef(0);
  const startedAt = useRef(0);
  const idle = useRef({ idle: false, locked: false });
  const idleAbort = useRef<AbortController | null>(null);
  const evaluateRef = useRef<() => void>(() => {});

  const hasTask = !!task;

  /* ------------------------------------------------------------ which task am I working on? */
  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("tasks")
      .select("*, project:projects(key)")
      .eq("assignee_id", meId)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(1);
    setTask((data?.[0] as ActiveTask | undefined) ?? null);
  }, [meId]);

  useEffect(() => {
    const sb = createClient();
    void load();
    const ch = sb
      .channel(`work:${meId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `assignee_id=eq.${meId}` }, () => void load())
      .subscribe();
    // Reassignments away from me are not delivered by the filter above: look again now and then.
    const poll = window.setInterval(() => void load(), 30_000);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    // A card moved on this board: a card leaving In progress stops the clock and hides the pill immediately.
    const onMoved = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; to?: string }>).detail;
      if (d?.id && d.to && d.to !== "in_progress") setTask((cur) => (cur && cur.id === d.id ? null : cur));
      else void load();
    };
    window.addEventListener(TASK_MOVED, onMoved);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TASK_MOVED, onMoved);
      sb.removeChannel(ch);
    };
  }, [meId, load]);

  // Server state is the truth for "is the clock running"; keep the refs in step with it.
  useEffect(() => {
    taskRef.current = task;
    if (!inflight.current) running.current = !!task?.timer_started_at;
  }, [task]);

  // Visible clock.
  const isRunning = !!task?.timer_started_at;
  useEffect(() => {
    setNow(Date.now());
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning, task?.id]);

  /* ------------------------------------------------------------ talk to the database */
  const apply = useCallback(async (want: boolean, why: string | null) => {
    const t = taskRef.current;
    if (!t || inflight.current) return;
    inflight.current = true;
    const { data, error } = await createClient().rpc("set_task_timer", { p_task: t.id, p_running: want, p_reason: why });
    inflight.current = false;
    if (error) {
      if (/STALE/.test(error.message)) void load();
      return;
    }
    running.current = want;
    lastBeat.current = Date.now();
    setTask((cur) => (cur && cur.id === t.id ? { ...cur, ...(data as Task) } : cur));
  }, [load]);

  // First sight of a task in this tab: report in at once. If the clock was left running by a tab that is gone
  // (closed yesterday), the database settles that stretch at its last sign of life instead of showing a day of work.
  const seenTask = useRef<string | null>(null);
  useEffect(() => {
    if (!task) {
      seenTask.current = null;
      return;
    }
    if (seenTask.current === task.id) return;
    seenTask.current = task.id;
    if (task.timer_started_at) void apply(true, null);
  }, [task, apply]);

  /** Decide from everything we know whether the clock should run, and act if it differs. */
  evaluateRef.current = () => {
    if (!taskRef.current || inflight.current) return;
    const t = Date.now();
    const run = running.current;
    const c = camRef.current;
    let want: boolean;
    let why: string | null = null;
    if (c === "denied" || c === "error") {
      want = false;
      why = "camera";
    } else if (idle.current.locked) {
      want = false;
      why = "locked";
    } else if (idle.current.idle) {
      want = false;
      why = "idle";
    } else if (c !== "on" || !matcher.current) {
      // Still starting: leave the clock as it is, but not forever.
      const late = t - startedAt.current > START_GRACE_MS;
      want = run && !late;
      why = "camera";
    } else if (asleep.current) {
      want = false;
      why = "sleep";
    } else {
      const away = t - lastSeen.current > AWAY_MS;
      want = run ? !away : streak.current >= RESUME_FRAMES;
      why = stranger.current ? "other" : "away";
    }
    if (want !== run) void apply(want, want ? null : why);
    else if (want && t - lastBeat.current > HEARTBEAT_MS) void apply(true, null); // heartbeat
  };

  /* ------------------------------------------------------------ face models + the captured face */
  useEffect(() => {
    if (!hasTask) return;
    let dead = false;
    setModel("loading");
    matcher.current = null;
    loadFaceMatcher(avatar)
      .then((m) => {
        if (dead) return;
        matcher.current = m;
        setEnrolled(m.enrolled);
        setModel("ready");
      })
      .catch(() => !dead && setModel("error"));
    return () => {
      dead = true;
    };
  }, [hasTask, modelTry, avatar]);

  /* ------------------------------------------------------------ camera + once-a-second check */
  useEffect(() => {
    if (!hasTask) return;
    let dead = false;
    let stream: MediaStream | null = null;
    let stopTick = () => {};
    const setCamState = (c: Cam) => {
      camRef.current = c;
      setCam(c);
    };
    if (camPaused) {
      // Idle or locked: no camera until the person is back (the cleanup below has already released it).
      setCamState("idle");
      return;
    }
    setCamState("starting");
    startedAt.current = Date.now();
    lastSeen.current = Date.now();
    streak.current = 0;
    stranger.current = false;
    asleep.current = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No camera", "NotFoundError");
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
      } catch (e) {
        if (!dead) setCamState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
        evaluateRef.current();
        return;
      }
      if (dead) return stream.getTracks().forEach((t) => t.stop());
      const tr = stream.getVideoTracks()[0] ?? null;
      track.current = tr;
      tr?.addEventListener("ended", () => {
        setCamState("error");
        evaluateRef.current();
      });
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
      }
      lastSeen.current = Date.now();
      setCamState("on");

      let lastTick = Date.now();
      let busy = false;
      stopTick = steadyInterval(1000, async () => {
        const t = Date.now();
        const gap = t - lastTick;
        lastTick = t;
        if (gap > SLEEP_GAP_MS) {
          // The computer slept or was locked: whoever comes back has to be seen again.
          asleep.current = true;
          streak.current = 0;
          lastSeen.current = 0;
        }
        const m = matcher.current;
        if (m && !busy && camRef.current === "on") {
          busy = true;
          try {
            const frame = await grabFrame(track.current, video.current);
            if (frame) {
              const who = await m.check(frame);
              (frame as ImageBitmap).close?.();
              stranger.current = who === "other";
              if (who === "me") {
                lastSeen.current = Date.now();
                streak.current++;
                if (streak.current >= RESUME_FRAMES) asleep.current = false;
              } else {
                streak.current = 0;
              }
            }
          } catch {
            /* a failed frame says nothing about the person: keep the current state */
          } finally {
            busy = false;
          }
        }
        evaluateRef.current();
      });
    })();

    return () => {
      dead = true;
      stopTick();
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
      if (video.current) video.current.srcObject = null;
    };
  }, [hasTask, camTry, camPaused]);

  /* ------------------------------------------------------------ idle / locked screen (Chrome, Edge) */
  const startIdle = useCallback(async () => {
    const Ctor = idleCtor();
    if (!Ctor) return;
    idleAbort.current?.abort();
    const ctrl = new AbortController();
    idleAbort.current = ctrl;
    try {
      const d: IdleDetectorLike = new Ctor();
      d.addEventListener("change", () => {
        idle.current = { idle: d.userState === "idle", locked: d.screenState === "locked" };
        setCamPaused(idle.current.idle || idle.current.locked);
        evaluateRef.current();
      });
      await d.start({ threshold: IDLE_MS, signal: ctrl.signal });
      idle.current = { idle: d.userState === "idle", locked: d.screenState === "locked" };
      setCamPaused(idle.current.idle || idle.current.locked);
      setIdleSupport("on");
    } catch {
      if (!ctrl.signal.aborted) setIdleSupport("denied");
    }
  }, []);

  useEffect(() => {
    if (!hasTask) return;
    let dead = false;
    idle.current = { idle: false, locked: false };
    setCamPaused(false);
    if (!idleCtor()) {
      setIdleSupport("unsupported");
      return;
    }
    void idlePermission().then((p) => {
      if (dead) return;
      if (p === "granted") void startIdle();
      else setIdleSupport(p === "denied" ? "denied" : "needs-permission");
    });
    return () => {
      dead = true;
      idleAbort.current?.abort();
      idle.current = { idle: false, locked: false };
      setCamPaused(false);
    };
  }, [hasTask, startIdle]);

  const allowIdle = async () => {
    const Ctor = idleCtor();
    if (!Ctor) return;
    try {
      if ((await Ctor.requestPermission()) === "granted") void startIdle();
      else setIdleSupport("denied");
    } catch {
      setIdleSupport("denied");
    }
  };

  if (!task) return null;

  const secs = elapsedSeconds(task, now);
  const { state, label }: { state: "run" | "pause" | "warn" | "load"; label: string } =
    cam === "denied" ? { state: "warn", label: "Camera blocked. Allow it to run the timer." }
    : cam === "error" ? { state: "warn", label: "No camera available. The timer is paused." }
    : cam === "idle" ? { state: "pause", label: `${PAUSE_LABEL[task.timer_pause_reason ?? "idle"] ?? "Paused"} · camera off` }
    : model === "error" ? { state: "warn", label: "Face recognition could not load." }
    : cam !== "on" || model !== "ready" ? { state: "load", label: cam === "on" ? "Loading face check…" : "Starting camera…" }
    : task.timer_started_at ? { state: "run", label: enrolled ? "Tracking · you are recognised" : "Tracking · camera on" }
    : { state: "pause", label: PAUSE_LABEL[task.timer_pause_reason ?? "away"] ?? "Paused" };

  return (
    <aside className="work-pill" data-state={state} aria-live="polite" aria-label="Work timer">
      <video ref={video} className="work-cam" muted playsInline autoPlay aria-hidden />
      <div className="work-info">
        <span className="work-task">{task.project?.key ? `${task.project.key}-${task.number}` : `#${task.number}`} · {task.title}</span>
        <span className="work-clock">{fmtClock(secs)}</span>
        <span className="work-state"><i aria-hidden /> {label}</span>
      </div>
      <div className="work-actions">
        {(cam === "denied" || cam === "error") && (
          <button type="button" className="btn sm" onClick={() => setCamTry((n) => n + 1)}><Icon n="camera" size={13} /> Retry</button>
        )}
        {model === "error" && <button type="button" className="btn sm" onClick={() => setModelTry((n) => n + 1)}>Retry</button>}
        {!enrolled && model === "ready" && (
          <span className="work-state" title="Your profile photo has no clear face, so any face is accepted. Retake it in Settings.">
            No face in profile photo
          </span>
        )}
        {idleSupport === "needs-permission" && cam === "on" && (
          <button type="button" className="btn subtle sm" title="Pause the timer when the computer is idle or locked" onClick={() => void allowIdle()}>
            Detect idle &amp; lock
          </button>
        )}
      </div>
    </aside>
  );
}
