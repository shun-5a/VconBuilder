/**
 * Editing operations. Every mutating function takes a mutable Project (an immer draft in the app)
 * and keeps the invariants: clips sorted by start, no overlaps within a track, end > start >= 0.
 */

import { syncAssetGroups } from "./assetGroups";
import { ensurePreset, requiredKey, showTrackInAllPresets, syncPresets } from "./preview";
import type { Clip, Field, FieldType, Project, Track, TrackKind } from "./schema";
import { framesToTc, tcToFrames } from "./timecode";

export type ClipRef = { trackId: string; clipId: string };

export const startF = (c: Clip, fps: number) => tcToFrames(c.start, fps);
export const endF = (c: Clip, fps: number) => tcToFrames(c.end, fps);
export const durF = (c: Clip, fps: number) => endF(c, fps) - startF(c, fps);

export function getTrack(p: Project, trackId: string): Track {
  const t = p.tracks.find((t) => t.id === trackId);
  if (!t) throw new Error(`track not found: ${trackId}`);
  return t;
}

export function getClip(p: Project, ref: ClipRef): Clip {
  const c = getTrack(p, ref.trackId).clips.find((c) => c.id === ref.clipId);
  if (!c) throw new Error(`clip not found: ${ref.clipId}`);
  return c;
}

export function findClip(p: Project, ref: ClipRef | null): Clip | undefined {
  if (!ref) return undefined;
  return p.tracks.find((t) => t.id === ref.trackId)?.clips.find((c) => c.id === ref.clipId);
}

function setRange(c: Clip, s: number, e: number, fps: number) {
  c.start = framesToTc(s, fps);
  c.end = framesToTc(e, fps);
}

export function sortClips(t: Track, fps: number) {
  t.clips.sort((a, b) => startF(a, fps) - startF(b, fps));
}

/** The clip covering `frame` (start inclusive, end exclusive). */
export function clipAt(t: Track, frame: number, fps: number): Clip | undefined {
  return t.clips.find((c) => startF(c, fps) <= frame && frame < endF(c, fps));
}

export function projectEndFrame(p: Project): number {
  const fps = p.settings.fps;
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, endF(c, fps));
  return end;
}

// ---------------------------------------------------------------- ids

function allClipIds(p: Project): Set<string> {
  return new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

export function nextClipId(p: Project, t: Track, taken = allClipIds(p)): string {
  for (let n = t.clips.length + 1; ; n++) {
    const id = `${t.id}-${String(n).padStart(3, "0")}`;
    if (!taken.has(id)) return id;
  }
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

// ---------------------------------------------------------------- tracks & fields

/** Starting columns of a new track (the media column holds images / videos or audio files). */
export function defaultFields(kind: TrackKind): Field[] {
  if (kind === "text")
    return [
      { key: "text", label: "Text", type: "text" },
      { key: "note", label: "Notes", type: "text" },
    ];
  return [
    { key: "ref", label: "Reference", type: "media" },
    { key: "note", label: "Notes", type: "text" },
  ];
}

const KIND_ID: Record<TrackKind, string> = { visual: "visual", audio: "audio", text: "text" };
const KIND_NAME: Record<TrackKind, string> = { visual: "Visual", audio: "Audio", text: "Text" };

/** Next free default name such as "Video 2". */
export function defaultTrackName(p: Project, kind: TrackKind): string {
  const names = new Set(p.tracks.map((t) => t.name));
  for (let n = 1; ; n++) if (!names.has(`${KIND_NAME[kind]} ${n}`)) return `${KIND_NAME[kind]} ${n}`;
}

/** ASCII id from a track name ("Main Video" → "main-video"); empty for names without ASCII letters/digits. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Adds a track; its id is derived from the name when possible (readable in JSON / for AI), else from the kind. */
export function addTrack(p: Project, kind: TrackKind, name?: string): string {
  const given = name?.trim();
  const id = uniqueId((given && slugify(given)) || KIND_ID[kind], new Set(p.tracks.map((t) => t.id)));
  const track: Track = { id, name: given || defaultTrackName(p, kind), kind, fields: defaultFields(kind), clips: [] };
  p.tracks.push(track);
  if (kind !== "audio") showTrackInAllPresets(p, track);
  return id;
}

export function removeTrack(p: Project, trackId: string) {
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  syncPresets(p);
}

export function moveTrack(p: Project, trackId: string, delta: number) {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= p.tracks.length) return;
  const [t] = p.tracks.splice(i, 1);
  p.tracks.splice(j, 0, t);
}

/** Adds a column; audio tracks only get text columns (their one media column is the audio file). */
export function addField(p: Project, trackId: string, type: FieldType, label?: string): string {
  const t = getTrack(p, trackId);
  if (t.kind !== "visual") type = "text";
  const key = uniqueId(type === "media" ? "media" : "text", new Set(t.fields.map((f) => f.key)));
  t.fields.push({ key, label: label ?? (type === "media" ? "Media" : "Text"), type });
  return key;
}

/** Removes a column (the required Reference column stays). */
export function removeField(p: Project, trackId: string, key: string) {
  const t = getTrack(p, trackId);
  if (key === requiredKey(t)) return;
  t.fields = t.fields.filter((f) => f.key !== key);
  for (const c of t.clips) delete c[key];
  syncPresets(p);
}

/** Moves a column left / right; the Reference column stays first. */
export function moveField(p: Project, trackId: string, key: string, delta: number) {
  const t = getTrack(p, trackId);
  const i = t.fields.findIndex((f) => f.key === key);
  const j = i + delta;
  const first = requiredKey(t) ? 1 : 0;
  if (i < first || j < first || j >= t.fields.length) return;
  const [f] = t.fields.splice(i, 1);
  t.fields.splice(j, 0, f);
}

/**
 * Every track starts with a media column (Reference): the first media column is moved to the front,
 * or a new one is added when the track has none.
 */
export function ensureMainColumn(t: Track) {
  // Visual / audio tracks start with their media (Reference); text tracks with the text that is drawn.
  const type = t.kind === "text" ? "text" : "media";
  if (t.fields[0]?.type === type) return;
  const i = t.fields.findIndex((f) => f.type === type);
  if (i >= 0) t.fields.unshift(...t.fields.splice(i, 1));
  else if (type === "text") t.fields.unshift({ key: uniqueId("text", new Set(t.fields.map((f) => f.key))), label: "Text", type });
  else t.fields.unshift({ key: uniqueId("ref", new Set(t.fields.map((f) => f.key))), label: "Reference", type });
}

// ---------------------------------------------------------------- clips

export function setClipValue(p: Project, ref: ClipRef, key: string, value: string | number | null) {
  const c = getClip(p, ref);
  if (value === null || value === "") delete c[key];
  else c[key] = value;
}

/** Shifts every clip of the track whose start is >= `from` by `delta` frames. */
function shiftFrom(t: Track, from: number, delta: number, fps: number, except?: Clip) {
  if (delta === 0) return;
  for (const c of t.clips) {
    if (c === except) continue;
    const s = startF(c, fps);
    if (s >= from) setRange(c, s + delta, endF(c, fps) + delta, fps);
  }
}

/** Free interval [lo, hi) around `frame`, ignoring `except`. Returns null when `frame` is inside a clip. */
function gapAt(t: Track, frame: number, fps: number, except?: Clip): [number, number] | null {
  let lo = 0;
  let hi = Infinity;
  for (const c of t.clips) {
    if (c === except) continue;
    const s = startF(c, fps);
    const e = endF(c, fps);
    if (s <= frame && frame < e) return null;
    if (e <= frame) lo = Math.max(lo, e);
    if (s > frame) hi = Math.min(hi, s);
  }
  return [lo, hi];
}

/** Adds a clip at `start`, shortened to fit the gap it lands in. Returns the new id, or null if `start` is occupied. */
export function addClip(
  p: Project,
  trackId: string,
  start: number,
  duration: number,
  values: Record<string, string | number> = {},
): string | null {
  const fps = p.settings.fps;
  const t = getTrack(p, trackId);
  const s = Math.max(0, Math.round(start));
  const gap = gapAt(t, s, fps);
  if (!gap) return null;
  const e = Math.min(s + Math.max(1, Math.round(duration)), gap[1]);
  const id = nextClipId(p, t);
  t.clips.push({ id, start: framesToTc(s, fps), end: framesToTc(e, fps), ...values });
  sortClips(t, fps);
  return id;
}

/** Appends a clip after the last clip of the track. */
export function appendClip(p: Project, trackId: string, duration: number): string {
  const fps = p.settings.fps;
  const t = getTrack(p, trackId);
  const last = t.clips.reduce((m, c) => Math.max(m, endF(c, fps)), 0);
  return addClip(p, trackId, last, duration)!;
}

/** Inserts a clip right after `ref`, pushing the following clips back (like inserting a spreadsheet row). */
export function insertClipAfter(p: Project, ref: ClipRef, duration: number): string {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const at = endF(getClip(p, ref), fps);
  shiftFrom(t, at, duration, fps);
  return addClip(p, ref.trackId, at, duration)!;
}

/**
 * Inserts a clip at `start`, pushing every clip that starts at or after it back by `duration`.
 * Returns null when `start` falls inside an existing clip.
 */
export function insertClipAt(
  p: Project,
  trackId: string,
  start: number,
  duration: number,
  values: Record<string, string | number> = {},
): string | null {
  const fps = p.settings.fps;
  const t = getTrack(p, trackId);
  const s = Math.max(0, Math.round(start));
  const d = Math.max(1, Math.round(duration));
  if (!gapAt(t, s, fps)) return null;
  shiftFrom(t, s, d, fps);
  return addClip(p, trackId, s, d, values);
}

export function removeClip(p: Project, ref: ClipRef, ripple: boolean) {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const c = getClip(p, ref);
  const s = startF(c, fps);
  const e = endF(c, fps);
  t.clips = t.clips.filter((x) => x !== c);
  if (ripple) shiftFrom(t, e, -(e - s), fps);
}

/**
 * Slip edit: changes which part of the source a clip plays (its `offset`, in frames) without moving or
 * resizing the clip. The offset stays >= 0 and, when the source length is known (`maxOffset` = source
 * frames - clip frames), small enough that the clip does not run past the end of the source.
 */
export function slipClip(p: Project, ref: ClipRef, offset: number, maxOffset?: number) {
  const fps = p.settings.fps;
  const c = getClip(p, ref);
  let o = Math.round(offset);
  if (maxOffset !== undefined) o = Math.min(o, Math.max(0, Math.round(maxOffset)));
  o = Math.max(0, o);
  if (o > 0) c.offset = framesToTc(o, fps);
  else delete c.offset;
}

/** Copies a clip (same place and values, new id) and returns the copy's id; move it with moveClip. */
export function duplicateClip(p: Project, ref: ClipRef): string {
  const t = getTrack(p, ref.trackId);
  const c = getClip(p, ref);
  const id = nextClipId(p, t);
  t.clips.push({ ...c, id });
  return id;
}

/**
 * Swaps a row with the one above (delta -1) or below (+1) while both keep their lengths: the pair still
 * covers the same span (and the gap between them stays), so nothing else on the track moves.
 * e.g. 01:00–02:00 and 02:00–04:00 become 01:00–03:00 (the second row) and 03:00–04:00 (the first).
 */
export function swapClip(p: Project, ref: ClipRef, delta: -1 | 1) {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const i = t.clips.findIndex((c) => c.id === ref.clipId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= t.clips.length) return;
  const [a, b] = i < j ? [t.clips[i], t.clips[j]] : [t.clips[j], t.clips[i]];
  const span0 = startF(a, fps);
  const gap = startF(b, fps) - endF(a, fps);
  const durA = endF(a, fps) - startF(a, fps);
  const durB = endF(b, fps) - startF(b, fps);
  setRange(b, span0, span0 + durB, fps);
  setRange(a, span0 + durB + gap, span0 + durB + gap + durA, fps);
  sortClips(t, fps);
}

/**
 * Moves a clip so it starts at `start`.
 * ripple: the clip and everything after it shift together (can't move before the previous clip's end).
 * otherwise: the clip lands in the free slot nearest to `start` that fits its duration.
 */
export function moveClip(p: Project, ref: ClipRef, start: number, ripple = false) {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const c = getClip(p, ref);
  const s0 = startF(c, fps);
  const dur = durF(c, fps);
  if (ripple) {
    const prevEnd = t.clips.reduce((m, x) => (x !== c && endF(x, fps) <= s0 ? Math.max(m, endF(x, fps)) : m), 0);
    const delta = Math.max(prevEnd, Math.round(start)) - s0;
    shiftFrom(t, s0 + 1, delta, fps, c);
    setRange(c, s0 + delta, s0 + delta + dur, fps);
  } else {
    const target = Math.max(0, Math.round(start));
    const slot = nearestSlot(t, target, dur, fps, c);
    setRange(c, slot, slot + dur, fps);
  }
  sortClips(t, fps);
}

function nearestSlot(t: Track, target: number, dur: number, fps: number, except: Clip): number {
  const others = t.clips
    .filter((c) => c !== except)
    .map((c) => [startF(c, fps), endF(c, fps)] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of others) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  gaps.push([cursor, Infinity]);
  let best = target;
  let bestDist = Infinity;
  for (const [lo, hi] of gaps) {
    if (hi - lo < dur) continue;
    const pos = Math.min(Math.max(target, lo), hi - dur);
    const d = Math.abs(pos - target);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

/**
 * Moves one edge of a clip.
 * start edge: limited by the previous clip; audio/video `offset` follows so the content stays in place.
 * end edge: limited by the next clip unless `ripple`, in which case following clips shift with it.
 */
export function trimClip(p: Project, ref: ClipRef, edge: "start" | "end", frame: number, ripple = false) {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const c = getClip(p, ref);
  const s = startF(c, fps);
  const e = endF(c, fps);
  const f = Math.round(frame);
  if (edge === "start") {
    const prevEnd = t.clips.reduce((m, x) => (x !== c && endF(x, fps) <= s ? Math.max(m, endF(x, fps)) : m), 0);
    let ns = Math.min(Math.max(f, prevEnd), e - 1);
    if (c.offset !== undefined || isTimedMedia(c)) {
      const off = c.offset ? tcToFrames(c.offset, fps) : 0;
      ns = Math.max(ns, s - off);
      c.offset = framesToTc(off + (ns - s), fps);
    }
    setRange(c, ns, e, fps);
  } else {
    let ne = Math.max(f, s + 1);
    if (ripple) {
      shiftFrom(t, e, ne - e, fps, c);
    } else {
      const nextStart = t.clips.reduce((m, x) => (x !== c && startF(x, fps) >= e ? Math.min(m, startF(x, fps)) : m), Infinity);
      ne = Math.min(ne, nextStart);
    }
    setRange(c, s, ne, fps);
  }
  sortClips(t, fps);
}

const TIMED_MEDIA = /\.(mp4|mov|webm|m4v|mkv|wav|mp3|m4a|aac|ogg|flac)$/i;
const isTimedMedia = (c: Clip) => typeof c.ref === "string" && TIMED_MEDIA.test(c.ref);

/** Sets the clip duration, shifting following clips when `ripple`. */
export function setClipDuration(p: Project, ref: ClipRef, duration: number, ripple: boolean) {
  const fps = p.settings.fps;
  const c = getClip(p, ref);
  trimClip(p, ref, "end", startF(c, fps) + Math.max(1, duration), ripple);
}

/** Splits a clip at `frame`; returns the id of the right half (or null if `frame` is not inside the clip). */
export function splitClip(p: Project, ref: ClipRef, frame: number): string | null {
  const fps = p.settings.fps;
  const t = getTrack(p, ref.trackId);
  const c = getClip(p, ref);
  const s = startF(c, fps);
  const e = endF(c, fps);
  const f = Math.round(frame);
  if (f <= s || f >= e) return null;
  const id = nextClipId(p, t);
  const right: Clip = { ...c, id, start: framesToTc(f, fps), end: framesToTc(e, fps) };
  if (c.offset !== undefined || isTimedMedia(c)) {
    const off = c.offset ? tcToFrames(c.offset, fps) : 0;
    right.offset = framesToTc(off + (f - s), fps);
  }
  c.end = framesToTc(f, fps);
  t.clips.push(right);
  sortClips(t, fps);
  return id;
}

/** Points every media value that references `from` to `to` (after an asset was renamed). */
export function renameMediaRefs(p: Project, from: string, to: string) {
  for (const t of p.tracks) {
    const media = t.fields.filter((f) => f.type === "media").map((f) => f.key);
    for (const c of t.clips) for (const k of media) if (c[k] === from) c[k] = to;
  }
}

/**
 * Re-times every timecode for a new frame rate, keeping positions in seconds. Rounding must not create
 * empty clips or overlaps (e.g. 60 → 24 fps turns frames 2..3 into 1..1): every clip keeps at least one
 * frame, and a clip that would overlap the previous one is pushed back.
 */
export function changeFps(p: Project, fps: number) {
  const old = p.settings.fps;
  if (old === fps) return;
  const toNew = (tc: string) => Math.round((tcToFrames(tc, old) * fps) / old);
  for (const t of p.tracks) {
    sortClips(t, old);
    let prevEnd = 0;
    for (const c of t.clips) {
      let s = toNew(c.start);
      let e = Math.max(toNew(c.end), s + 1);
      if (s < prevEnd) {
        e += prevEnd - s;
        s = prevEnd;
      }
      c.start = framesToTc(s, fps);
      c.end = framesToTc(e, fps);
      if (c.offset) c.offset = framesToTc(toNew(c.offset), fps);
      prevEnd = e;
    }
  }
  p.settings.fps = fps;
}

// ---------------------------------------------------------------- normalization / validation

/** Fixes what can be fixed after loading a hand- or AI-edited file: sorts clips and de-duplicates ids. */
export function normalizeProject(p: Project) {
  for (const t of p.tracks) ensureMainColumn(t);
  ensurePreset(p);
  syncPresets(p);
  syncAssetGroups(p);
  // Clip ids are not stored in the file: give every row a positional id (<trackId>-001, ...).
  const taken = new Set<string>();
  for (const t of p.tracks) {
    sortClips(t, p.settings.fps);
    let n = 1;
    for (const c of t.clips) {
      let id: string;
      do id = `${t.id}-${String(n++).padStart(3, "0")}`;
      while (taken.has(id));
      c.id = id;
      taken.add(id);
    }
  }
}

/** Human-readable problems that are allowed in the file but worth showing (overlaps, bad references...). */
export function validateProject(p: Project): string[] {
  const fps = p.settings.fps;
  const out: string[] = [];
  const trackIds = new Set<string>();
  for (const t of p.tracks) {
    if (trackIds.has(t.id)) out.push(`Duplicate track id: ${t.id}`);
    trackIds.add(t.id);
    let prev: Clip | undefined;
    t.clips.forEach((c, i) => {
      const row = `[${t.name}] row ${i + 1}`;
      if (endF(c, fps) <= startF(c, fps)) out.push(`${row}: OUT is not after IN`);
      if (prev && startF(c, fps) < endF(prev, fps)) out.push(`${row} overlaps row ${i}`);
      for (const tc of [c.start, c.end]) {
        if (Number(tc.split(":")[3]) >= fps) out.push(`${row}: frame number is >= fps (${fps}): ${tc}`);
      }
      prev = c;
    });
  }
  for (const preset of p.exportPresets) {
    for (const s of preset.screens) if (!trackIds.has(s)) out.push(`Preset "${preset.name}": unknown track ${s}`);
  }
  return out;
}
