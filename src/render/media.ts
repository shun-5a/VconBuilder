export type MediaKind = "image" | "video" | "audio";

const EXT: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  mkv: "video",
  wav: "audio",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
};

export function mediaKind(ref: unknown): MediaKind | null {
  if (typeof ref !== "string") return null;
  const m = /\.([A-Za-z0-9]+)$/.exec(ref);
  return m ? (EXT[m[1].toLowerCase()] ?? null) : null;
}

// ------------------------------------------------------------ change notification

const listeners = new Set<() => void>();
/** Called whenever an image/video finishes loading or seeking, so views can redraw. */
export function onMediaUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const notify = () => {
  for (const cb of listeners) cb();
};

/** Drops everything cached for a media URL (the file changed on disk) and redraws. */
export function forgetMedia(url: string) {
  const img = images.get(url);
  if (img) img.onload = null;
  images.delete(url);
  const v = videos.get(url);
  if (v) {
    v.onseeked = v.onloadeddata = null;
    v.pause();
    v.removeAttribute("src");
    v.load();
  }
  videos.delete(url);
  durations.delete(url);
  notify();
}

// ------------------------------------------------------------ images

const images = new Map<string, HTMLImageElement>();

/** Returns the image when loaded; otherwise starts loading it and returns null. */
export function getImage(url: string): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.onload = notify;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob);
}

// ------------------------------------------------------------ preview videos

const videos = new Map<string, HTMLVideoElement>();

function getVideoEl(url: string): HTMLVideoElement {
  let v = videos.get(url);
  if (!v) {
    v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.onseeked = notify;
    v.onloadeddata = notify;
    v.src = url;
    videos.set(url, v);
  }
  return v;
}

/**
 * Keeps a preview <video> at `seconds` (playing or paused) and returns it once it has a frame.
 * During playback it only re-seeks when it drifts, so playback stays smooth.
 */
export function syncVideo(url: string, seconds: number, playing: boolean): HTMLVideoElement | null {
  const v = getVideoEl(url);
  const t = Math.max(0, seconds);
  if (playing) {
    if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
    if (v.paused) v.play().catch(() => {});
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - t) > 0.01 && !v.seeking) v.currentTime = t;
  }
  return v.readyState >= 2 ? v : null;
}

/** Pauses preview videos not in `active`. */
export function pauseVideosExcept(active: Set<string>) {
  for (const [url, v] of videos) if (!active.has(url) && !v.paused) v.pause();
}

// ------------------------------------------------------------ durations

const durations = new Map<string, Promise<number>>();

/** Duration in seconds of a video/audio file (via media element metadata). */
export function mediaDuration(url: string, kind: MediaKind): Promise<number> {
  let p = durations.get(url);
  if (!p) {
    p = new Promise<number>((resolve) => {
      const el = document.createElement(kind === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => {
        durations.delete(url); // not cached: the file may still be being written
        resolve(0);
      };
      el.src = url;
    });
    durations.set(url, p);
  }
  return p;
}
