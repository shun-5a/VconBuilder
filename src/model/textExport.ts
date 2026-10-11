/** Markdown / CSV export of the sequence tables. */

import { buildMergedRows } from "./merged";
import { durF, endF, startF } from "./ops";
import type { Clip, Project, Track } from "./schema";
import { formatDuration, framesToTc } from "./timecode";

const cellText = (v: unknown) => (v === undefined || v === null ? "" : String(v));

// ------------------------------------------------------------------ Markdown

const mdEscape = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

function mdTable(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(mdEscape).join(" | ")} |`;
  return [line(head), `|${head.map(() => " --- ").join("|")}|`, ...rows.map(line)].join("\n");
}

export function trackToMarkdown(p: Project, t: Track): string {
  const fps = p.settings.fps;
  const head = ["IN", "OUT", "Length", ...t.fields.map((f) => f.label)];
  const rows = t.clips.map((c) => [
    framesToTc(startF(c, fps), fps),
    framesToTc(endF(c, fps), fps),
    formatDuration(durF(c, fps), fps),
    ...t.fields.map((f) => cellText(c[f.key])),
  ]);
  return mdTable(head, rows);
}

/** One table for several tracks, split at every cut point. A clip continuing from the row above shows "〃". */
export function mergedToMarkdown(p: Project, trackIds: string[]): string {
  const fps = p.settings.fps;
  const tracks = trackIds.map((id) => p.tracks.find((t) => t.id === id)).filter((t): t is Track => !!t);
  const head = ["IN", "OUT", "Length", ...tracks.flatMap((t) => t.fields.map((f) => `${t.name}: ${f.label}`))];
  const active = new Map<string, Clip | null>();
  const rows = buildMergedRows(p, trackIds).map((row) => {
    const cells = [framesToTc(row.start, fps), framesToTc(row.end, fps), formatDuration(row.end - row.start, fps)];
    for (const t of tracks) {
      const cell = row.cells[t.id];
      if (cell?.kind === "clip") active.set(t.id, cell.clip);
      else if (cell?.kind === "gap") active.set(t.id, null);
      const clip = active.get(t.id);
      const continued = cell?.kind === "covered";
      cells.push(...t.fields.map((f) => (clip ? (continued ? "〃" : cellText(clip[f.key])) : "")));
    }
    return cells;
  });
  return mdTable(head, rows);
}

export function projectToMarkdown(p: Project, title = "Sequence"): string {
  const { fps, width, height } = p.settings;
  const parts = [`# ${title}`, "", `${width}×${height} / ${fps} fps`, ""];
  for (const t of p.tracks) parts.push(`## ${t.name} (${t.kind})`, "", trackToMarkdown(p, t), "");
  const picture = p.tracks.filter((t) => t.kind !== "audio").map((t) => t.id);
  if (picture.length > 1) parts.push("## Combined", "", mergedToMarkdown(p, picture), "");
  return parts.join("\n");
}

// ------------------------------------------------------------------ CSV

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV with a UTF-8 BOM so Excel opens Japanese text correctly. Columns: IN, OUT, Length, then field labels. */
export function trackToCsv(p: Project, t: Track): string {
  const fps = p.settings.fps;
  const rows = [
    ["IN", "OUT", "Length", ...t.fields.map((f) => f.label)],
    ...t.clips.map((c) => [
      framesToTc(startF(c, fps), fps),
      framesToTc(endF(c, fps), fps),
      framesToTc(durF(c, fps), fps),
      ...t.fields.map((f) => cellText(c[f.key])),
    ]),
  ];
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
