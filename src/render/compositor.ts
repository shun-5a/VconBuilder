/**
 * Draws one output frame: screens (tracks) + captions + timecode.
 * Used both by the live preview and by the exporter, so the export looks exactly like the preview.
 */

import { clipAt, startF } from "../model/ops";
import { captionKeys, defaultPreset, insetKeys, mainKey, requiredKey, shownOverlays, shownScreens } from "../model/preview";
import type { Clip, ExportPreset, InsetPosition, Project, Track } from "../model/schema";
import { framesToTc, tcToFrames } from "../model/timecode";
import { mediaKind } from "./media";

export type Visual = CanvasImageSource & { width?: number; height?: number };

/**
 * Supplies the picture for a media clip at `seconds` into the source, or null when not ready.
 * `clip` identifies the clip so callers can keep per-clip decoders.
 */
export type VisualProvider = (ref: string, seconds: number, clip: Clip, track: Track) => Visual | null;

export type ResolvedPreset = Omit<ExportPreset, "screens"> & { screens: string[]; width: number; height: number; fps: number };

/**
 * Fills in preset defaults from the project settings. Screens are the visual tracks switched on;
 * one screen fills the frame, more are laid out in a grid.
 */
export function resolvePreset(p: Project, preset: ExportPreset | undefined): ResolvedPreset {
  const base = preset ?? defaultPreset(p, "preview", "Preview");
  const screens = shownScreens(p, base);
  return {
    ...base,
    screens,
    layout: screens.length > 1 ? "grid" : "single",
    width: base.width ?? p.settings.width,
    height: base.height ?? p.settings.height,
    fps: base.fps ?? p.settings.fps,
  };
}

export const FONT_FAMILY = `"Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans JP", sans-serif`;

type Rect = { x: number; y: number; w: number; h: number };

const mediaValue = (clip: Clip, key: string | null) => {
  const v = key && clip[key];
  return typeof v === "string" && v ? v : null;
};

/** The clip's media in the Reference column (visual: the picture; audio: the sound), or null. */
export function clipMediaRef(track: Track, clip: Clip): string | null {
  return mediaValue(clip, mainKey(track));
}

/** Every image / video the preset draws for a clip: the picture, then the insets. */
export function clipVisualRefs(track: Track, clip: Clip, preset: ExportPreset): string[] {
  return [clipMediaRef(track, clip), ...insetKeys(preset, track).map((k) => mediaValue(clip, k))].filter(
    (r): r is string => !!r && (mediaKind(r) === "image" || mediaKind(r) === "video"),
  );
}

/** Thumbnail for the timeline: the picture, else the first filled media column. */
export function clipThumbRef(track: Track, clip: Clip): string | null {
  const shown = clipMediaRef(track, clip);
  if (shown) return shown;
  for (const f of track.fields) {
    if (f.type === "media" && typeof clip[f.key] === "string" && clip[f.key]) return clip[f.key] as string;
  }
  return null;
}

/** First non-empty text field, skipping `skip` keys (used as a text card when there is no picture). */
export function clipText(track: Track, clip: Clip, skip: string[] = []): string {
  for (const f of track.fields) {
    if (skip.includes(f.key)) continue;
    const v = clip[f.key];
    if (f.type === "text" && v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

/** Source-media time (seconds) for `frame` inside `clip`. */
export function mediaSeconds(clip: Clip, frame: number, fps: number): number {
  const off = clip.offset ? tcToFrames(clip.offset, fps) : 0;
  return (frame - startF(clip, fps) + off) / fps;
}

function layoutScreens(n: number, w: number, h: number, layout: "single" | "grid"): Rect[] {
  if (n === 0) return [];
  if (layout === "single" || n === 1) return [{ x: 0, y: 0, w, h }];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = Math.round(h * 0.006);
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * (cw + gap),
    y: Math.floor(i / cols) * (ch + gap),
    w: cw,
    h: ch,
  }));
}

function sourceSize(src: Visual): [number, number] {
  const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth || src.width || 1;
  const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight || src.height || 1;
  return [Number(sw), Number(sh)];
}

function drawContain(ctx: CanvasRenderingContext2D, src: Visual, r: Rect) {
  const [sw, sh] = sourceSize(src);
  const s = Math.min(r.w / Number(sw), r.h / Number(sh));
  const dw = Number(sw) * s;
  const dh = Number(sh) * s;
  ctx.drawImage(src, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
}

/**
 * Draws insets in a corner of the screen at `sizePct` % of its width, stacked vertically away from the corner
 * (each keeps its aspect ratio, framed by a thin outline).
 */
function drawInsets(ctx: CanvasRenderingContext2D, visuals: Visual[], r: Rect, position: InsetPosition, sizePct: number) {
  const margin = r.w * 0.015;
  const gap = margin * 0.6;
  const w = (r.w * sizePct) / 100;
  const right = position.endsWith("right");
  const bottom = position.startsWith("bottom");
  let along = margin;
  for (const v of visuals) {
    const [sw, sh] = sourceSize(v);
    const h = (w * sh) / sw;
    const x = right ? r.x + r.w - margin - w : r.x + margin;
    const y = bottom ? r.y + r.h - along - h : r.y + along;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(v, x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(1, r.w * 0.0015);
    ctx.strokeRect(x, y, w, h);
    along += h + gap;
  }
}

/** Wraps text to `maxWidth`, character by character (works for Japanese without spaces). */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n|<br\s*\/?>/i)) {
    let line = "";
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch.trimStart();
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

type TextPosition = "top" | "center" | "bottom";

/** A laid-out caption / text band: its background box (x, y, w, h) in frame pixels and its lines. */
type TextBlock = Rect & { lines: string[]; fontPx: number; cx: number; align: "center" | "left" };

/**
 * left: a band in the top-left corner (screen captions), `top` px below the screen's top edge.
 * center: a centred band at `position` (text tracks).
 */
type BlockOptions = { align: "center" } | { align: "left"; top: number };

/** Lays out `text` in a band of `r` (wrapped to 90% of its width), `stackOffset` px away from the edge. */
function layoutTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  r: Rect,
  position: TextPosition,
  fontPx: number,
  stackOffset: number,
  opts: BlockOptions = { align: "center" },
): TextBlock {
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  const padX = fontPx * 0.5;
  const left = opts.align === "left";
  // Corner captions stay narrower, so they cover less of the picture.
  const lines = wrapText(ctx, text, r.w * (left ? 0.6 : 0.9));
  const h = lines.length * fontPx * 1.35 + fontPx * 0.5;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  if (opts.align === "left") {
    const x = r.x + r.h * 0.02;
    return { x, y: r.y + opts.top + stackOffset, w, h, lines, fontPx, cx: x + padX, align: "left" };
  }
  const margin = r.h * 0.05;
  let y: number;
  if (position === "top") y = r.y + margin + stackOffset;
  else if (position === "center") y = r.y + (r.h - h) / 2 + stackOffset;
  else y = r.y + r.h - margin - h - stackOffset;
  return { x: r.x + (r.w - w) / 2, y, w, h, lines, fontPx, cx: r.x + r.w / 2, align: "center" };
}

function paintTextBlock(ctx: CanvasRenderingContext2D, b: TextBlock) {
  ctx.font = `600 ${b.fontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = "#fff";
  ctx.textAlign = b.align;
  ctx.textBaseline = "top";
  const lh = b.fontPx * 1.35;
  for (const [i, l] of b.lines.entries()) ctx.fillText(l, b.cx, b.y + b.fontPx * 0.25 + i * lh + b.fontPx * 0.12);
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Moves a text-track band off the captions (and earlier bands) it would cover: bottom / center bands move up,
 * top bands move down. If that would push it out of the frame it stays where it was (overlapping beats invisible).
 */
function avoidBlocks(b: TextBlock, position: TextPosition, obstacles: Rect[], frameH: number, gap: number): TextBlock {
  const placed = { ...b };
  for (let i = 0; i < obstacles.length + 1; i++) {
    const hit = obstacles.find((o) => overlaps(placed, o, gap));
    if (!hit) return placed;
    placed.y = position === "top" ? hit.y + hit.h + gap : hit.y - placed.h - gap;
    if (placed.y < 0 || placed.y + placed.h > frameH) return b;
  }
  return b;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontPx: number, align: "left" | "right") {
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  const w = ctx.measureText(text).width;
  const pad = fontPx * 0.35;
  const bx = align === "left" ? x : x - w - pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(bx, y, w + pad * 2, fontPx * 1.5);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + pad, y + fontPx * 0.78);
}

/**
 * Renders the frame at `frame` (in project fps) for `preset` into a canvas of preset.width × preset.height.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  preset: ResolvedPreset,
  frame: number,
  getVisual: VisualProvider,
) {
  const fps = project.settings.fps;
  const W = preset.width;
  const H = preset.height;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const screens = preset.screens.map((id) => project.tracks.find((t) => t.id === id)).filter((t): t is Track => !!t && t.kind !== "audio");
  const shown = preset.layout === "single" ? screens.slice(0, 1) : screens;
  const rects = layoutScreens(shown.length, W, H, preset.layout);
  const rectOf = new Map<string, Rect>();

  shown.forEach((track, i) => {
    const r = rects[i];
    rectOf.set(track.id, r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = shown.length > 1 ? "#14151c" : "#000";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const clip = clipAt(track, frame, fps);
    if (clip) {
      const ref = clipMediaRef(track, clip);
      const kind = mediaKind(ref);
      const visual = ref && (kind === "image" || kind === "video") ? getVisual(ref, mediaSeconds(clip, frame, fps), clip, track) : null;
      if (visual) {
        drawContain(ctx, visual, r);
      } else if (!ref || (kind !== "image" && kind !== "video")) {
        // No picture: show the cue text as a title card (e.g. lighting cues described in words).
        // Prefer a column that is not already burned in as a caption, so the text is not shown twice.
        const text = clipText(track, clip, captionKeys(preset, track));
        ctx.fillStyle = "#282a36";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.font = `600 ${r.h * 0.06}px ${FONT_FAMILY}`;
        const lines = wrapText(ctx, text, r.w * 0.8).slice(0, 6);
        const lh = r.h * 0.08;
        ctx.fillStyle = "#f8f8f2";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const [li, l] of lines.entries()) ctx.fillText(l, r.x + r.w / 2, r.y + r.h / 2 + (li - (lines.length - 1) / 2) * lh);
      }
      const insets = insetKeys(preset, track)
        .map((k) => mediaValue(clip, k))
        .filter((v): v is string => !!v && (mediaKind(v) === "image" || mediaKind(v) === "video"))
        .map((v) => getVisual(v, mediaSeconds(clip, frame, fps), clip, track))
        .filter((v): v is Visual => !!v);
      drawInsets(ctx, insets, r, preset.insetStyle.position, preset.insetStyle.size);
    }
    if (preset.layout === "grid" && preset.showLabels && shown.length > 1) {
      drawLabel(ctx, track.name, r.x + r.h * 0.02, r.y + r.h * 0.02, r.h * 0.035, "left");
    }
    ctx.restore();
  });

  // Captions: the preset's caption columns of each track on screen, in the screen's top-left corner, stacked
  // downwards in column order (below the track name when names are shown). Text tracks use `position`.
  const captionBoxes: Rect[] = [];
  const { position, size } = preset.captionStyle;
  const labels = preset.layout === "grid" && preset.showLabels && shown.length > 1;
  for (const track of shown) {
    const clip = clipAt(track, frame, fps);
    if (!clip) continue;
    const texts = captionKeys(preset, track)
      .map((k) => clip[k])
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map(String);
    const r = rectOf.get(track.id)!;
    // The track name label (drawLabel above) ends at about 7.5% of the screen height.
    const top = labels ? r.h * 0.09 : r.h * 0.02;
    let off = 0;
    for (const text of texts) {
      const b = layoutTextBlock(ctx, text, r, "top", (r.h * size) / 100, off, { align: "left", top });
      paintTextBlock(ctx, b);
      captionBoxes.push(b);
      off += b.h + b.fontPx * 0.3;
    }
  }

  // Text tracks: over the whole frame (across all screens), in the captions' style and stacked with them,
  // moved off any caption they would cover.
  const fontPx = (H * size) / 100;
  const obstacles: Rect[] = [...captionBoxes];
  let stack = 0;
  for (const track of shownOverlays(project, preset)) {
    const clip = clipAt(track, frame, fps);
    const key = requiredKey(track);
    const v = clip && key ? clip[key] : null;
    if (v === undefined || v === null || v === "") continue;
    const laid = layoutTextBlock(ctx, String(v), { x: 0, y: 0, w: W, h: H }, position, fontPx, stack);
    const b = avoidBlocks(laid, position, obstacles, H, fontPx * 0.3);
    paintTextBlock(ctx, b);
    obstacles.push(b);
    stack += b.h + fontPx * 0.3;
  }

  if (preset.burnTimecode) {
    drawLabel(ctx, framesToTc(frame, fps), W - H * 0.02, H * 0.02, H * 0.03, "right");
  }
  ctx.restore();
}
