import { useEffect, useRef, useState } from "react";
import { clipAt, endF, findClip, insertClipAfter, removeClip, startF } from "../../model/ops";
import type { Track } from "../../model/schema";
import { framesToTc } from "../../model/timecode";
import { useStore } from "../../store/store";
import { DEFAULT_STILL_SECONDS } from "../actions";
import { Popover } from "../Popover";
import { seek } from "../preview/player";
import { AddColumnBar, AddRowBar, ClipCell, ColumnHeader, columnKey, columnWidth, TimeRange, trackColumns } from "./cells";

const TIME_W = 104;

/** One track as a full-width table; rows overlapping the selected clip (on any track) are highlighted. */
export function TrackTable({ track }: { track: Track }) {
  const fps = useStore((s) => s.project!.settings.fps);
  const selection = useStore((s) => s.selection);
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const edit = useStore((s) => s.edit);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cols = trackColumns(track);
  const tableWidth = TIME_W + cols.reduce((a, c) => a + columnWidth(c), 0);

  const selClip = useStore((s) => findClip(s.project!, s.selection));
  const selRange = selClip ? [startF(selClip, fps), endF(selClip, fps)] : null;
  const playingClip = clipAt(track, playhead, fps);

  // Follow the playhead while playing, and the selection (or what overlaps it) otherwise.
  const followId = playing
    ? playingClip?.id
    : selection?.trackId === track.id
      ? selection.clipId
      : selRange
        ? track.clips.find((c) => startF(c, fps) < selRange[1] && endF(c, fps) > selRange[0])?.id
        : undefined;
  useEffect(() => {
    const el = scrollRef.current;
    const row = followId ? el?.querySelector<HTMLElement>(`tr[data-clip="${followId}"]`) : null;
    if (!el || !row) return;
    const headH = el.querySelector("thead")?.clientHeight ?? 0;
    if (row.offsetTop - headH < el.scrollTop) el.scrollTop = row.offsetTop - headH;
    else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight;
  }, [followId]);

  const total = track.clips.length ? endF(track.clips[track.clips.length - 1], fps) : 0;

  // Right-click menu on a row.
  type RowMenu = { x: number; y: number; clipId: string; start: number };
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const rowAction = (m: RowMenu, action: "seek" | "insert" | "delete") => {
    setMenu(null);
    const ref = { trackId: track.id, clipId: m.clipId };
    if (action === "seek") seek(m.start);
    else if (action === "insert") {
      let id = "";
      edit((d) => {
        id = insertClipAfter(d, ref, DEFAULT_STILL_SECONDS * fps);
      });
      useStore.getState().select({ trackId: track.id, clipId: id });
    } else {
      // Later rows move up, like deleting a spreadsheet row.
      edit((d) => removeClip(d, ref, true));
    }
  };

  return (
    <div className={`ttrack kind-${track.kind}`}>
      <div className="ttrack-head">
        <span>{track.name}</span>
        <div className="spacer" />
        <span className="dim small tc" title="Rows / end of the last row">
          {track.clips.length} rows / {framesToTc(total, fps)}
        </span>
      </div>
      <div className="tscroll" ref={scrollRef}>
        <div className="sheet">
          <div className="sheet-main">
            <table className="grid" style={{ width: tableWidth }}>
              <thead>
                <tr>
                  <th style={{ width: TIME_W }}>IN ~ OUT</th>
                  {cols.map((c) => (
                    <ColumnHeader key={columnKey(c)} track={track} col={c} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {track.clips.map((c) => {
                  const s = startF(c, fps);
                  const e = endF(c, fps);
                  const selected = selection?.trackId === track.id && selection.clipId === c.id;
                  const overlap = !selected && selRange && s < selRange[1] && e > selRange[0];
                  const cls = [selected && "row-selected", overlap && "row-overlap", playingClip === c && "row-playing"]
                    .filter(Boolean)
                    .join(" ");
                  const ref = { trackId: track.id, clipId: c.id };
                  return (
                    <tr
                      key={c.id}
                      data-clip={c.id}
                      className={cls}
                      onPointerDown={() => useStore.getState().select(ref)}
                      onContextMenu={(ev) => {
                        // Keep the normal copy / paste menu inside text fields.
                        if ((ev.target as HTMLElement).closest("input, textarea")) return;
                        ev.preventDefault();
                        setMenu({ x: ev.clientX, y: ev.clientY, clipId: c.id, start: s });
                      }}
                    >
                      <td className="timecell">
                        <TimeRange track={track} clip={c} />
                      </td>
                      {cols.map((col) => (
                        <ClipCell key={columnKey(col)} track={track} clip={c} col={col} />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AddColumnBar track={track} />
          </div>
          <AddRowBar track={track} width={tableWidth} />
          <Popover at={menu} open={!!menu} onClose={() => setMenu(null)}>
            {menu && (
              <>
                <button className="ghost" onClick={() => rowAction(menu, "seek")}>
                  Move playhead here
                </button>
                <button className="ghost" onClick={() => rowAction(menu, "insert")}>
                  Insert row below
                </button>
                <div className="menu-sep" />
                <button className="ghost" onClick={() => rowAction(menu, "delete")}>
                  Delete row
                </button>
              </>
            )}
          </Popover>
        </div>
        {!track.clips.length && <div className="empty-hint">Click + to add a row, or drop media on the timeline</div>}
      </div>
    </div>
  );
}
