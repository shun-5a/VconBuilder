import { endF, startF } from "../model/ops";
import type { Project, Track } from "../model/schema";
import { tcToFrames } from "../model/timecode";
import { clipMediaRef } from "../render/compositor";
import { mediaKind } from "../render/media";

let sharedCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: "interactive" });
  return sharedCtx;
}

// ------------------------------------------------------------ decoding

const buffers = new Map<string, Promise<AudioBuffer | null>>();
const decoded = new Map<string, AudioBuffer>();

export function loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => getAudioContext().decodeAudioData(b))
      .then((buf) => {
        decoded.set(url, buf);
        return buf;
      })
      .catch((e) => {
        console.warn("audio decode failed", url, e);
        return null;
      });
    buffers.set(url, p);
  }
  return p;
}

export const getDecodedBuffer = (url: string) => decoded.get(url) ?? null;

// ------------------------------------------------------------ mixing

export const dbToGain = (db: number | undefined) => 10 ** ((db ?? 0) / 20);

/** Audio tracks that should be heard (not muted). */
export function audibleTracks(p: Project): Track[] {
  return p.tracks.filter((t) => t.kind === "audio" && !t.mute);
}

/** Loads every audio file used by audible tracks. */
export async function preloadProjectAudio(p: Project, urlOf: (rel: string) => string) {
  const urls = new Set<string>();
  for (const t of audibleTracks(p)) {
    for (const c of t.clips) {
      const ref = clipMediaRef(t, c);
      if (ref && mediaKind(ref) === "audio") urls.add(urlOf(ref));
    }
  }
  await Promise.all([...urls].map(loadAudioBuffer));
}

/**
 * Schedules all audible clips on `ctx` so that project frame `fromFrame` plays at context time `when`.
 * Works for both the live AudioContext and an OfflineAudioContext (export). Returns the started sources.
 */
export function scheduleAudio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  p: Project,
  urlOf: (rel: string) => string,
  fromFrame: number,
  when: number,
  toFrame = Infinity,
): AudioBufferSourceNode[] {
  const fps = p.settings.fps;
  const nodes: AudioBufferSourceNode[] = [];
  for (const t of audibleTracks(p)) {
    const trackGain = dbToGain(t.volume);
    for (const c of t.clips) {
      const ref = clipMediaRef(t, c);
      if (!ref || mediaKind(ref) !== "audio") continue;
      const buf = decoded.get(urlOf(ref));
      if (!buf) continue;
      const s = startF(c, fps);
      const e = Math.min(endF(c, fps), toFrame);
      if (e <= fromFrame || s >= e) continue;

      const local0 = Math.max(0, fromFrame - s);
      const playAt = when + Math.max(0, s - fromFrame) / fps;
      const srcOffset = ((c.offset ? tcToFrames(c.offset, fps) : 0) + local0) / fps;
      if (srcOffset >= buf.duration) continue;
      const dur = (e - Math.max(s, fromFrame)) / fps;

      const g = ctx.createGain();
      g.gain.value = trackGain;
      g.connect(dest);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(playAt, srcOffset, dur);
      nodes.push(src);
    }
  }
  return nodes;
}

// ------------------------------------------------------------ waveform

const peaksCache = new WeakMap<AudioBuffer, Float32Array>();
export const PEAKS_PER_SECOND = 100;

/** Max absolute amplitude per 1/100 s, mixed down to mono. */
export function getPeaks(buf: AudioBuffer): Float32Array {
  let peaks = peaksCache.get(buf);
  if (peaks) return peaks;
  const step = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SECOND));
  const n = Math.ceil(buf.length / step);
  peaks = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let j = i * step; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      if (m > peaks[i]) peaks[i] = m;
    }
  }
  peaksCache.set(buf, peaks);
  return peaks;
}
