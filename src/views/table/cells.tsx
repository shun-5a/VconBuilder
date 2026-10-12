import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { assetUrl } from "../../io/backend";
import {
  addField,
  appendClip,
  type ClipRef,
  endF,
  moveClip,
  moveField,
  removeField,
  setClipValue,
  startF,
  trimClip,
} from "../../model/ops";
import { captionKeys, insetKeys, mainKey, toggleCaption, toggleInset } from "../../model/preview";
import type { Clip, Field, Track } from "../../model/schema";
import { framesToTc, parseTcInput } from "../../model/timecode";
import { mediaKind } from "../../render/media";
import { currentPreset, useStore } from "../../store/store";
import { acceptsMedia, DEFAULT_STILL_SECONDS } from "../actions";
import { Popover } from "../Popover";
import { updatePreview } from "../preview/presets";
import { MediaPicker } from "./MediaPicker";

// ------------------------------------------------------------------ column model

export type Column = { kind: "field"; field: Field };

/** Columns after the IN ~ OUT cell: the track's fields. */
export function trackColumns(track: Track): Column[] {
  return track.fields.map((field) => ({ kind: "field" as const, field }));
}

/** Stable React key of a column. */
export const columnKey = (c: Column) => `field:${c.field.key}`;

export function columnWidth(c: Column): number {
  return c.field.width ?? (c.field.type === "media" ? 140 : 200);
}

export function ColumnHeader({ track, col, className }: { track: Track; col: Column; className?: string }) {
  return <FieldHeader track={track} field={col.field} className={className} />;
}

/**
 * ◉ / ◌ in a column header: whether the column appears in the current preset (preview and export).
 * Extra media column = a small inset in a corner of the track screen; text column = caption (any number of each).
 * The Reference column has none: it is always the picture.
 */
function ShowToggle({ track, field }: { track: Track; field: Field }) {
  const preset = useStore(currentPreset);
  const on = field.type === "media" ? insetKeys(preset, track).includes(field.key) : captionKeys(preset, track).includes(field.key);
  const where = preset ? ` in "${preset.name}"` : "";
  const what = field.type === "media" ? "an inset" : "a caption";
  const title = on ? `Shown as ${what}${where} (click to hide)` : `Click to show this column as ${what}${where}`;
  const toggle = () =>
    updatePreview((p) => (field.type === "media" ? toggleInset(p, track, field.key) : toggleCaption(p, track, field.key)));
  return (
    <button className={`show-toggle ${on ? "on" : ""} ${field.type}`} title={title} onClick={toggle}>
      {on ? "◉" : "◌"}
    </button>
  );
}

function FieldHeader({ track, field, className }: { track: Track; field: Field; className?: string }) {
  const [editing, setEditing] = useState(false);
  // The first column (Reference) is required: always the picture / audio file, never moved or deleted.
  const main = field.key === mainKey(track);
  const index = track.fields.indexOf(field);
  const edit = useStore((s) => s.edit);
  const del = async () => {
    const used = track.clips.filter((c) => c[field.key] !== undefined && c[field.key] !== "").length;
    if (
      used &&
      !(await confirm(`Delete column "${field.label}"? (${used} values will be removed)`, { title: "Delete column", kind: "warning" }))
    )
      return;
    edit((d) => removeField(d, track.id, field.key));
  };
  return (
    <th
      className={className}
      style={{ width: columnWidth({ kind: "field", field }) }}
      title={
        main
          ? `key: ${field.key} / required: ${track.kind === "audio" ? "the audio file" : "always the picture"}`
          : `key: ${field.key} / ${field.type}`
      }
    >
      <div className="th-inner">
        {track.kind === "visual" && !main && <ShowToggle track={track} field={field} />}
        {editing ? (
          <input
            autoFocus
            defaultValue={field.label}
            style={{ width: "100%" }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== field.label)
                edit((d) => {
                  const f = d.tracks.find((t) => t.id === track.id)?.fields.find((f) => f.key === field.key);
                  if (f) f.label = v;
                });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="lbl" onDoubleClick={() => setEditing(true)}>
            {field.type === "media" ? "🖼 " : ""}
            {field.label}
          </span>
        )}
        {!main && (
          <span className="th-tools">
            <button
              className="ghost"
              disabled={index <= (mainKey(track) ? 1 : 0)}
              onClick={() => edit((d) => moveField(d, track.id, field.key, -1))}
              title="Move left"
            >
              ◀
            </button>
            <button
              className="ghost"
              disabled={index === track.fields.length - 1}
              onClick={() => edit((d) => moveField(d, track.id, field.key, 1))}
              title="Move right"
            >
              ▶
            </button>
            <button className="ghost" onClick={del} title="Delete column">
              ✕
            </button>
          </span>
        )}
      </div>
    </th>
  );
}

/**
 * Vertical "+" bar on the right edge of the table (Notion style): adds a text or media column.
 * Audio tracks only take text columns, so the bar adds one directly.
 */
export function AddColumnBar({ track }: { track: Track }) {
  const edit = useStore((s) => s.edit);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const add = (type: "text" | "media") => {
    setOpen(false);
    edit((d) => void addField(d, track.id, type));
  };
  const audio = track.kind === "audio";
  return (
    <>
      <button
        ref={ref}
        className={`add-col-bar ${open ? "on" : ""}`}
        title={audio ? "Add a text column" : "Add a column"}
        onClick={() => (audio ? add("text") : setOpen(!open))}
      >
        +
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        <button className="ghost" onClick={() => add("text")}>
          Text column
        </button>
        <button className="ghost" onClick={() => add("media")}>
          Media column (image / video)
        </button>
      </Popover>
    </>
  );
}

/** Horizontal "+" bar under the table (Notion style): click appends a row. */
export function AddRowBar({ track, width }: { track: Track; width: number }) {
  const fps = useStore((s) => s.project!.settings.fps);
  const add = () => {
    let id = "";
    useStore.getState().edit((d) => {
      id = appendClip(d, track.id, DEFAULT_STILL_SECONDS * fps);
    });
    if (id) useStore.getState().select({ trackId: track.id, clipId: id });
  };
  return (
    <button className="add-row-bar" style={{ width }} title="Add a row" onClick={add}>
      +
    </button>
  );
}

// ------------------------------------------------------------------ cells

type CellProps = { track: Track; clip: Clip; col: Column; rowSpan?: number; className?: string };

export function ClipCell({ track, clip, col, rowSpan, className }: CellProps) {
  const ref: ClipRef = { trackId: track.id, clipId: clip.id };
  const edit = useStore((s) => s.edit);
  const td = (children: React.ReactNode) => (
    <td rowSpan={rowSpan} className={className}>
      {children}
    </td>
  );

  const key = col.field.key;
  const v = clip[key];
  if (col.field.type === "media") {
    return td(
      <MediaInput track={track} value={typeof v === "string" ? v : ""} onCommit={(nv) => edit((d) => setClipValue(d, ref, key, nv))} />,
    );
  }
  return td(
    <TextInput value={v === undefined || v === null ? "" : String(v)} onCommit={(nv) => edit((d) => setClipValue(d, ref, key, nv))} />,
  );
}

function TextInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  // Escape blurs right away, before the draft reset reaches onBlur, so the blur must know to skip the commit.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the height whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      className="cell-input"
      rows={1}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current) cancelled.current = false;
        else if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

/** IN and OUT stacked in one compact cell ("00:00:00:00 ~ 00:00:04:00"); both editable. */
export function TimeRange({ track, clip }: { track: Track; clip: Clip }) {
  const fps = useStore((s) => s.project!.settings.fps);
  const edit = useStore((s) => s.edit);
  const ref: ClipRef = { trackId: track.id, clipId: clip.id };
  // The table works like a spreadsheet: changing a row's times pushes / pulls the rows after it.
  const ripple = () => true;
  return (
    <div className="time-range">
      <TcInput frames={startF(clip, fps)} fps={fps} onCommit={(f) => edit((d) => moveClip(d, ref, f, ripple()))} />
      <span className="tilde">~</span>
      <TcInput frames={endF(clip, fps)} fps={fps} onCommit={(f) => edit((d) => trimClip(d, ref, "end", f, ripple()))} />
    </div>
  );
}

function TcInput({
  frames,
  fps,
  onCommit,
  format = (f) => framesToTc(f, fps),
}: {
  frames: number;
  fps: number;
  onCommit: (f: number) => void;
  format?: (f: number) => string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const f = parseTcInput(draft, fps, frames);
    if (f === null) {
      setBad(true);
      setTimeout(() => setBad(false), 800);
    } else if (f !== frames) onCommit(f);
    setDraft(null);
  };
  return (
    <input
      className={`cell-input tc ${bad ? "bad" : ""}`}
      value={draft ?? format(frames)}
      title="e.g. 1:02:03:04 / 10203 / 2.5s / +12 (frames) / -1s"
      onFocus={(e) => {
        setDraft(format(frames));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function MediaInput({ track, value, onCommit }: { track: Track; value: string; onCommit: (v: string | null) => void }) {
  const dir = useStore((s) => s.dir)!;
  const assets = useStore((s) => s.assets);
  useStore((s) => s.assetEpoch); // re-render with the new URL when the file is replaced on disk
  const [picking, setPicking] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const kind = mediaKind(value);
  const url = value ? assetUrl(dir, value) : "";
  const choices = assets.filter((a) => acceptsMedia(track.kind, a));

  // Media is chosen from the assets list (drag & drop goes to the timeline / Assets tab).
  return (
    <div className="media-cell" ref={cellRef}>
      {value && kind === "image" && <img src={url} alt="" draggable={false} />}
      {value && kind === "video" && <video src={url} muted preload="metadata" />}
      {value ? (
        <span className="media-name" title={value}>
          {kind === "audio" ? "♪ " : ""}
          {value.replace(/^assets\//, "")}
        </span>
      ) : (
        <span className="media-empty">Click to choose</span>
      )}
      {/* Mounted per opening, so its groups start from the Assets tab state each time. */}
      {picking && (
        <MediaPicker
          anchor={cellRef}
          open
          choices={choices}
          value={value}
          onPick={(rel) => {
            setPicking(false);
            if (rel !== (value || null)) onCommit(rel);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {!picking && (
        <div className="media-tools">
          <button className="ghost icon" onClick={() => setPicking(true)} title="Choose from assets">
            …
          </button>
          {value && (
            <button className="ghost icon" onClick={() => onCommit(null)} title="Clear">
              ✕
            </button>
          )}
        </div>
      )}
      {!value && <div style={{ position: "absolute", inset: 0, cursor: "pointer" }} onClick={() => setPicking(!picking)} />}
    </div>
  );
}
