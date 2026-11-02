/**
 * Face recognition in the browser. Nothing leaves the computer: frames are analysed locally
 * (face-api: a small face detector + a face-recognition network, running on TensorFlow.js) and the
 * only thing used is "the person captured at account setup is / is not in front of the camera".
 * The library and models are fetched from a CDN the first time (no npm dependency).
 */
import { MATCH_DISTANCE } from "./timer";

const VERSION = "1.7.15";
const BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VERSION}`;
const SCRIPT_URL = `${BASE}/dist/face-api.js`;
const MODEL_URL = `${BASE}/model`;

type Descriptor = Float32Array;
interface Found {
  descriptor: Descriptor;
}
interface FaceApi {
  tf: { ready(): Promise<void> };
  nets: Record<"tinyFaceDetector" | "faceLandmark68TinyNet" | "faceRecognitionNet", { loadFromUri(url: string): Promise<void> }>;
  TinyFaceDetectorOptions: new (o?: { inputSize?: number; scoreThreshold?: number }) => unknown;
  detectAllFaces(input: HTMLCanvasElement, o: unknown): { withFaceLandmarks(tiny: boolean): { withFaceDescriptors(): Promise<Found[]> } };
  detectSingleFace(input: HTMLCanvasElement, o: unknown): { withFaceLandmarks(tiny: boolean): { withFaceDescriptor(): Promise<Found | undefined> } };
  euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number;
}

/** "me" = the captured person is there, "other" = a face that is not them, "none" = nobody. */
export type Presence = "me" | "other" | "none";

export interface FaceMatcher {
  /** False when the profile photo has no usable face: any face is then accepted (and the UI says so). */
  enrolled: boolean;
  check(frame: CanvasImageSource): Promise<Presence>;
}

let apiPromise: Promise<FaceApi> | null = null;

function loadFaceApi(): Promise<FaceApi> {
  const w = window as unknown as { faceapi?: FaceApi };
  if (w.faceapi) return Promise.resolve(w.faceapi);
  if (!apiPromise) {
    apiPromise = (async () => {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Face recognition took too long to load")), 45_000);
        const s = document.createElement("script");
        s.src = SCRIPT_URL;
        s.async = true;
        s.onload = () => {
          window.clearTimeout(timer);
          resolve();
        };
        s.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Could not load face recognition"));
        };
        document.head.appendChild(s);
      });
      const api = w.faceapi;
      if (!api) throw new Error("Could not load face recognition");
      await api.tf.ready();
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return api;
    })().catch((e) => {
      apiPromise = null; // allow a retry
      throw e;
    });
  }
  return apiPromise;
}

/** Start downloading the models early (e.g. while someone is still taking their photo). */
export function preloadFaceApi() {
  void loadFaceApi().catch(() => {});
}

const detectorOptions = (api: FaceApi, scoreThreshold = 0.5) => new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold });

/** Average brightness (0 to 255) below which a frame is lifted before the face is looked for. */
const DARK_BELOW = 105;

/**
 * Low light: a dim webcam frame is lifted (gamma, so the shadows open up without burning the highlights)
 * so that the face can still be found and compared. Returns how dark the frame was (0 to 255).
 */
function brightenIfDark(c: HTMLCanvasElement): number {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 64) {
    sum += px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114;
    n++;
  }
  const mean = sum / Math.max(1, n);
  if (mean >= DARK_BELOW) return mean;
  // Lift the average towards mid-grey, never more than a factor of 4 (beyond that it is mostly noise).
  const gamma = Math.min(4, Math.max(1, Math.log(Math.max(mean, 4) / 255) / Math.log(0.45)));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, 1 / gamma));
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]!]!;
    px[i + 1] = lut[px[i + 1]!]!;
    px[i + 2] = lut[px[i + 2]!]!;
  }
  ctx.putImageData(img, 0, 0);
  return mean;
}

function toCanvas(src: CanvasImageSource, w: number, h: number, flip = false, scale = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  if (flip) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the photo"));
    img.src = url;
  });
}

/** Descriptors of the face in a profile photo: as saved and mirrored (the camera preview is mirrored). */
async function enroll(api: FaceApi, photo: string): Promise<Descriptor[]> {
  const img = await loadImage(photo);
  const out: Descriptor[] = [];
  for (const flip of [false, true]) {
    const c = toCanvas(img, img.naturalWidth, img.naturalHeight, flip, 2);
    const hit = await api.detectSingleFace(c, detectorOptions(api)).withFaceLandmarks(true).withFaceDescriptor();
    if (hit) out.push(hit.descriptor);
  }
  return out;
}

/** True / false = the photo does / does not show a face. null = could not be checked (models unavailable). */
export async function photoHasFace(photo: string): Promise<boolean | null> {
  try {
    const api = await loadFaceApi();
    return (await enroll(api, photo)).length > 0;
  } catch {
    return null;
  }
}

const enrolled = new Map<string, Descriptor[]>();

/**
 * A matcher for the person whose profile photo is `photo` (captured at account setup).
 * Resolves with `enrolled: false` when there is no usable photo.
 */
export async function loadFaceMatcher(photo: string | null): Promise<FaceMatcher> {
  const api = await loadFaceApi();
  let refs: Descriptor[] = [];
  if (photo) {
    refs = enrolled.get(photo) ?? (await enroll(api, photo).catch(() => []));
    if (refs.length) enrolled.set(photo, refs);
  }
  const canvas = document.createElement("canvas");
  return {
    enrolled: refs.length > 0,
    async check(frame) {
      const size = frame as unknown as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
      const w = size.videoWidth || size.width || 640;
      const h = size.videoHeight || size.height || 480;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d", { willReadFrequently: true })!.drawImage(frame, 0, 0, w, h);
      const mean = brightenIfDark(canvas);
      let faces = await api.detectAllFaces(canvas, detectorOptions(api)).withFaceLandmarks(true).withFaceDescriptors();
      // Dim and noisy: the detector is less sure of itself, so accept a weaker detection before giving up.
      if (faces.length === 0 && mean < DARK_BELOW) {
        faces = await api.detectAllFaces(canvas, detectorOptions(api, 0.3)).withFaceLandmarks(true).withFaceDescriptors();
      }
      if (faces.length === 0) return "none";
      if (refs.length === 0) return "me";
      let best = Infinity;
      for (const f of faces) for (const r of refs) best = Math.min(best, api.euclideanDistance(f.descriptor, r));
      return best <= MATCH_DISTANCE ? "me" : "other";
    },
  };
}

/** Calls `fn` every `ms`. Runs in a Worker so a tab in the background is not throttled to once a minute. */
export function steadyInterval(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }
}

/** Latest camera frame. ImageCapture keeps working while the tab is hidden; the <video> is the fallback. */
export async function grabFrame(track: MediaStreamTrack | null, video: HTMLVideoElement | null): Promise<CanvasImageSource | null> {
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (IC && track && track.readyState === "live") {
    try {
      return await new IC(track).grabFrame();
    } catch {
      /* fall through to the video element */
    }
  }
  return video && video.readyState >= 2 ? video : null;
}

/* ------------------------------------------------------------------ idle / locked screen */

export interface IdleDetectorLike extends EventTarget {
  userState: "active" | "idle";
  screenState: "locked" | "unlocked";
  start(o: { threshold: number; signal?: AbortSignal }): Promise<void>;
}
type IdleCtor = { new (): IdleDetectorLike; requestPermission(): Promise<"granted" | "denied"> };

export const idleCtor = (): IdleCtor | null => (typeof window !== "undefined" ? ((window as unknown as { IdleDetector?: IdleCtor }).IdleDetector ?? null) : null);

export async function idlePermission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const r = await navigator.permissions.query({ name: "idle-detection" as PermissionName });
    return r.state;
  } catch {
    return "prompt";
  }
}
