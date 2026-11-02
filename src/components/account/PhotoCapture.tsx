"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { photoHasFace, preloadFaceApi } from "@/lib/presence";
import { Icon } from "@/components/common/ui";

const SIZE = 192;

/** Centre-crops any image source to a small square JPEG (about 8 KB). */
function squareJpeg(src: CanvasImageSource, w: number, h: number, mirror: boolean): string {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const side = Math.min(w, h);
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return c.toDataURL("image/jpeg", 0.72);
}

/**
 * Take a profile photo with the camera (or pick a file when there is no camera).
 * Calls onChange with a JPEG data URL, or null after "Retake".
 * This photo is the reference the work timer compares the camera with, so a photo with no face is refused.
 */
export function PhotoCapture({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "blocked" | "none">("starting");
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => preloadFaceApi(), []);

  /** Accepts the photo only when a face can be found in it (if the check itself is unavailable, it is accepted). */
  const accept = async (url: string): Promise<boolean> => {
    setChecking(true);
    setProblem(null);
    const has = await photoHasFace(url);
    setChecking(false);
    if (has === false) {
      setProblem("No face found in that photo. Face the camera in good light and try again.");
      return false;
    }
    onChange(url);
    return true;
  };

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    if (value) return;
    let dead = false;
    setState("starting");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setState("none");
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
        if (dead) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setState("live");
      } catch (e) {
        if (!dead) setState((e as DOMException)?.name === "NotAllowedError" ? "blocked" : "none");
      }
    })();
    return () => {
      dead = true;
      stop();
    };
  }, [value, attempt, stop]);

  const snap = async () => {
    const v = video.current;
    if (!v || !v.videoWidth || checking) return;
    if (await accept(squareJpeg(v, v.videoWidth, v.videoHeight, true))) stop();
  };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const url = squareJpeg(bmp, bmp.width, bmp.height, false);
      bmp.close();
      await accept(url);
    } catch {
      /* not an image */
    }
  };

  if (value) {
    return (
      <div className="photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="photo-frame" src={value} alt="Your profile photo" />
        <button type="button" className="btn subtle sm" onClick={() => onChange(null)}>Retake</button>
      </div>
    );
  }
  return (
    <div className="photo">
      <div className="photo-frame" data-state={state}>
        <video ref={video} muted playsInline autoPlay aria-label="Camera preview" />
        {state === "starting" && <span className="photo-msg">Starting camera…</span>}
        {state === "blocked" && <span className="photo-msg">Camera blocked. Allow it in the address bar, then retry.</span>}
        {state === "none" && <span className="photo-msg">No camera found. Upload a photo instead.</span>}
      </div>
      {problem && <p className="form-error" role="alert">{problem}</p>}
      <div className="photo-actions">
        {state === "live" && (
          <button type="button" className="btn primary sm" disabled={checking} onClick={() => void snap()}>
            <Icon n="camera" size={14} /> {checking ? "Checking photo…" : "Take photo"}
          </button>
        )}
        {state === "blocked" && <button type="button" className="btn sm" onClick={() => setAttempt((a) => a + 1)}>Retry camera</button>}
        <label className="btn subtle sm" style={{ cursor: "pointer" }}>
          Upload instead
          <input type="file" accept="image/*" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}
