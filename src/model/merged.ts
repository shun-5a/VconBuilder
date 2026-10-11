import { endF, startF } from "./ops";
import type { Clip, Project } from "./schema";

export type MergedCell =
  | { kind: "clip"; clip: Clip; span: number }
  | { kind: "gap"; span: number }
  /** Covered by a cell above (rowSpan). */
  | { kind: "covered" };

export type MergedRow = { start: number; end: number; cells: Record<string, MergedCell> };

/**
 * Builds the "merged view": one row per interval between consecutive cut points of the given tracks.
 * Each track's clip occupies the rows it spans (rendered with rowSpan, like merged cells in Excel).
 */
export function buildMergedRows(p: Project, trackIds: string[]): MergedRow[] {
  const fps = p.settings.fps;
  const tracks = trackIds.map((id) => p.tracks.find((t) => t.id === id)).filter((t) => !!t);
  const cuts = new Set<number>([0]);
  for (const t of tracks) {
    for (const c of t.clips) {
      cuts.add(startF(c, fps));
      cuts.add(endF(c, fps));
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const rows: MergedRow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) rows.push({ start: sorted[i], end: sorted[i + 1], cells: {} });

  for (const t of tracks) {
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      const clip = t.clips.find((c) => startF(c, fps) <= row.start && row.start < endF(c, fps));
      let j = i + 1;
      if (clip) {
        const e = endF(clip, fps);
        while (j < rows.length && rows[j].start < e) j++;
        row.cells[t.id] = { kind: "clip", clip, span: j - i };
      } else {
        while (j < rows.length && !t.clips.some((c) => startF(c, fps) <= rows[j].start && rows[j].start < endF(c, fps))) j++;
        row.cells[t.id] = { kind: "gap", span: j - i };
      }
      for (let k = i + 1; k < j; k++) rows[k].cells[t.id] = { kind: "covered" };
      i = j;
    }
  }
  return rows;
}
