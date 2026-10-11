/**
 * Draws one output frame: screens (tracks) + captions + timecode.
 * Used both by the live preview and by the exporter, so the export looks exactly like the preview.
 */

import { clipAt, startF } from "../model/ops";
import { captionKeys, defaultPreset, insetKeys, mainKey, shownScreens } from "../model/preview";
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

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  r: Rect,
  position: "top" | "center" | "bottom",
  fontPx: number,
  stackOffset: number,
): number {
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  const lines = wrapText(ctx, text, r.w * 0.9);
  const lh = fontPx * 1.35;
  const padX = fontPx * 0.5;
  const padY = fontPx * 0.25;
  const blockH = lines.length * lh + padY * 2;
  const margin = r.h * 0.05;
  let y: number;
  if (position === "top") y = r.y + margin + stackOffset;
  else if (position === "center") y = r.y + (r.h - blockH) / 2 + stackOffset;
  else y = r.y + r.h - margin - blockH - stackOffset;
  const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(r.x + (r.w - maxW) / 2 - padX, y, maxW + padX * 2, blockH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const [i, l] of lines.entries()) ctx.fillText(l, r.x + r.w / 2, y + padY + i * lh + fontPx * 0.12);
  return blockH + fontPx * 0.3;
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

  // Captions: the preset's caption columns of each track on screen, stacked inside that screen in column order.
  const { position, size } = preset.captionStyle;
  for (const track of shown) {
    const clip = clipAt(track, frame, fps);
    if (!clip) continue;
    const texts = captionKeys(preset, track)
      .map((k) => clip[k])
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map(String);
    const r = rectOf.get(track.id)!;
    // Bottom captions are stacked upwards, so draw the last column first to keep reading order top-down.
    let off = 0;
    for (const text of position === "bottom" ? texts.reverse() : texts)
      off += drawTextBlock(ctx, text, r, position, (r.h * size) / 100, off);
  }

  if (preset.burnTimecode) {
    drawLabel(ctx, framesToTc(frame, fps), W - H * 0.02, H * 0.02, H * 0.03, "right");
  }
  ctx.restore();
}
