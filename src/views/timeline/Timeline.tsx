import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../../io/backend";
import { importDrop, isAcceptableDrag, snapshotDrop } from "../../io/dnd";
import { addClip, type ClipRef, endF, moveClip, moveTrack, projectEndFrame, removeTrack, startF, trimClip } from "../../model/ops";
import { shownScreens } from "../../model/preview";
import type { Clip, Track, TrackKind } from "../../model/schema";
import { formatDuration, framesToTc, tcToFrames } from "../../model/timecode";
import { clipThumbRef } from "../../render/compositor";
import { mediaKind } from "../../render/media";
import { currentPreset, useStore } from "../../store/store";
import { addAssetClip, DEFAULT_STILL_SECONDS } from "../actions";
import { NumberField } from "../NumberField";
import { seek } from "../preview/player";
import { toggleTrackOnScreen } from "../preview/presets";
import { Waveform } from "./Waveform";

const HEAD_W = 176;
const TRACK_H: Record<TrackKind, number> = { visual: 58, audio: 54 };
const SNAP_PX = 8;
const MIN_PPF = 0.02;
const MAX_PPF = 40;
const TICK_STEPS_SEC = [1 / 30, 0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const ppf = useStore((s) => s.pxPerFrame);
  const playhead = useStore((s) => s.playhead);
  const set = useStore((s) => s.set);
  const fps = project.settings.fps;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [snapLine, setSnapLine] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel: Ctrl+wheel zooms around the mouse; a plain wheel scrolls sideways when there is nothing to
  // scroll vertically (native listener so preventDefault works).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        if (!e.shiftKey && el.scrollHeight <= el.clientHeight && e.deltaX === 0) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const cur = useStore.getState().pxPerFrame;
      const next = Math.min(MAX_PPF, Math.max(MIN_PPF, cur * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const mx = e.clientX - el.getBoundingClientRect().left - HEAD_W;
      const frameAtMouse = (el.scrollLeft + mx) / cur;
      useStore.setState({ pxPerFrame: next });
      requestAnimationFrame(() => (el.scrollLeft = frameAtMouse * next - mx));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Hold the right mouse button and drag to scroll the timeline in any direction.
  const [panning, setPanning] = useState(false);
  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    const el = scrollRef.current!;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const left0 = el.scrollLeft;
    const top0 = el.scrollTop;
    setPanning(true);
    const move = (pe: PointerEvent) => {
      el.scrollLeft = left0 - (pe.clientX - x0);
      el.scrollTop = top0 - (pe.clientY - y0);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Keep the playhead in view while playing.
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = playhead * ppf;
    const visibleW = el.clientWidth - HEAD_W;
    if (x < el.scrollLeft || x > el.scrollLeft + visibleW - 20) el.scrollLeft = x - 40;
  }, [playhead, playing, ppf]);

  const end = projectEndFrame(project);
  const contentFrames = Math.max(end + 10 * fps, (viewW - HEAD_W) / ppf);
  const laneW = contentFrames * ppf;

  const fit = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.min(MAX_PPF, Math.max(MIN_PPF, (el.clientWidth - HEAD_W - 30) / Math.max(end, fps)));
    set({ pxPerFrame: next });
    el.scrollLeft = 0;
  };
  const zoom = (k: number) => set({ pxPerFrame: Math.min(MAX_PPF, Math.max(MIN_PPF, ppf * k)) });

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label">Timeline</span>
        <div className="spacer" />
        <button className="icon" onClick={() => zoom(1 / 1.5)} title="Zoom out">
          －
        </button>
        <button className="icon" onClick={() => zoom(1.5)} title="Zoom in">
          ＋
        </button>
        <button onClick={fit} title="Fit all">
          Fit
        </button>
      </div>
      <div className="pane-body">
        <div
          className={`timeline-scroll ${panning ? "panning" : ""}`}
          ref={scrollRef}
          onPointerDown={startPan}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="timeline-content" style={{ width: HEAD_W + laneW }}>
            <Ruler fps={fps} ppf={ppf} width={laneW} playhead={playhead} />
            {project.tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                count={project.tracks.length}
                fps={fps}
                ppf={ppf}
                laneW={laneW}
                onSnap={setSnapLine}
              />
            ))}
            {project.tracks.length > 0 && (
              <div className="track-add-row">
                <div className="track-add-cell" style={{ width: HEAD_W }}>
                  <button className="subtab add" onClick={() => useStore.setState({ addTrackOpen: true })} title="Add track">
                    ＋
                  </button>
                </div>
              </div>
            )}
            <div className="playhead" style={{ left: HEAD_W + playhead * ppf }} />
            {snapLine !== null && <div className="snapline" style={{ left: HEAD_W + snapLine * ppf }} />}
          </div>
        </div>
        {project.tracks.length === 0 && <NoTracks />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ruler

function Ruler({ fps, ppf, width, playhead }: { fps: number; ppf: number; width: number; playhead: number }) {
  const step = TICK_STEPS_SEC.find((s) => s * fps * ppf >= 70) ?? 600;
  const stepF = Math.max(1, Math.round(step * fps));
  const ticks = [];
  for (let f = 0; f * ppf < width; f += stepF) ticks.push(f);
  const minorF = stepF / 5 >= 1 && (stepF / 5) * ppf >= 10 ? stepF / 5 : null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const lane = e.currentTarget;
    const frameAt = (x: number) => (x - lane.getBoundingClientRect().left) / ppf;
    seek(frameAt(e.clientX));
    lane.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => seek(frameAt(ev.clientX));
    const up = () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
  };

  return (
    <div className="ruler">
      <div className="ruler-corner" style={{ width: HEAD_W }} />
      <div className="ruler-lane" onPointerDown={onPointerDown}>
        <div className="ruler-playhead" style={{ left: playhead * ppf }} />
        {ticks.map((f) => (
          <div key={f} className="tick tc" style={{ left: f * ppf }}>
            {framesToTc(f, fps).replace(/^00:/, "")}
          </div>
        ))}
        {minorF !== null &&
          ticks.flatMap((f) =>
            [1, 2, 3, 4].map((k) => <div key={`${f}-${k}`} className="tick minor" style={{ left: (f + k * minorF) * ppf }} />),
          )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ track row

type RowProps = {
  track: Track;
  index: number;
  count: number;
  fps: number;
  ppf: number;
  laneW: number;
  onSnap: (frame: number | null) => void;
};

function TrackRow({ track, index, count, fps, ppf, laneW, onSnap }: RowProps) {
  const selection = useStore((s) => s.selection);
  const [drop, setDrop] = useState(false);
  const laneRef = useRef<HTMLDivElement>(null);
  const h = TRACK_H[track.kind];
  const offScreen = useStore((s) => track.kind === "visual" && !shownScreens(s.project!, currentPreset(s)!).includes(track.id));

  const frameAtClientX = (x: number) => Math.max(0, Math.round((x - laneRef.current!.getBoundingClientRect().left) / ppf));

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== laneRef.current) return;
    const f = frameAtClientX(e.clientX);
    let id: string | null = null;
    useStore.getState().edit((d) => {
      id = addClip(d, track.id, f, DEFAULT_STILL_SECONDS * fps);
    });
    if (id) useStore.getState().select({ trackId: track.id, clipId: id });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrop(false);
    let f: number | null = frameAtClientX(e.clientX);
    const paths = await importDrop(snapshotDrop(e.dataTransfer));
    for (const rel of paths) {
      if (f === null) break;
      f = await addAssetClip(track.id, f, rel);
    }
  };

  return (
    <div className={`track-row kind-${track.kind}`} style={{ height: h }}>
      <TrackHeader track={track} index={index} count={count} />
      <div
        ref={laneRef}
        className={`lane ${drop ? "drop" : ""} ${offScreen ? "hidden-track" : ""}`}
        style={{ width: laneW }}
        onDoubleClick={onDoubleClick}
        onPointerDown={(e) => {
          if (e.button === 0 && e.target === laneRef.current) useStore.getState().select(null);
        }}
        onDragOver={(e) => {
          if (!isAcceptableDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDrop(true);
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={onDrop}
      >
        {track.clips.map((c) => (
          <ClipView
            key={c.id}
            track={track}
            clip={c}
            fps={fps}
            ppf={ppf}
            selected={selection?.trackId === track.id && selection.clipId === c.id}
            onSnap={onSnap}
          />
        ))}
      </div>
    </div>
  );
}

function TrackHeader({ track, index, count }: { track: Track; index: number; count: number }) {
  const [editing, setEditing] = useState(false);
  const edit = useStore((s) => s.edit);
  const onScreen = useStore((s) => shownScreens(s.project!, currentPreset(s)!).includes(track.id));
  const patch = (fn: (t: Track) => void) =>
    edit((d) => {
      const t = d.tracks.find((x) => x.id === track.id);
      if (t) fn(t);
    });

  const del = async () => {
    const ok = await confirm(`Delete track "${track.name}" and its ${track.clips.length} clips?`, {
      title: "Delete track",
      kind: "warning",
    });
    if (ok) edit((d) => removeTrack(d, track.id));
  };

  return (
    <div className="track-head" style={{ width: HEAD_W }}>
      <div className="name" onDoubleClick={() => setEditing(true)} title={`${track.id} (double-click to rename)`}>
        {editing ? (
          <input
            autoFocus
            defaultValue={track.name}
            style={{ width: 120 }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== track.name)
                patch((t) => {
                  t.name = v;
                });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span>{track.name}</span>
        )}
      </div>
      <div className="btns">
        <button className="ghost" disabled={index === 0} onClick={() => edit((d) => moveTrack(d, track.id, -1))} title="Move up">
          ▲
        </button>
        <button className="ghost" disabled={index === count - 1} onClick={() => edit((d) => moveTrack(d, track.id, 1))} title="Move down">
          ▼
        </button>
        {track.kind === "audio" ? (
          <>
            <button
              className={`show-toggle ${track.mute ? "" : "on"}`}
              onClick={() =>
                patch((t) => {
                  t.mute = !t.mute || undefined;
                })
              }
              title={track.mute ? "Muted in preview / export (click to unmute)" : "Heard in preview / export (click to mute)"}
            >
              {track.mute ? "◌" : "◉"}
            </button>
            <NumberField
              className="vol"
              min={-60}
              max={12}
              step={1}
              value={track.volume ?? 0}
              title="Track volume (dB, -60 to +12)"
              onCommit={(v) =>
                patch((t) => {
                  t.volume = v || undefined;
                })
              }
            />
          </>
        ) : (
          <button
            className={`show-toggle ${onScreen ? "on" : ""}`}
            onClick={() => toggleTrackOnScreen(track.id)}
            title={onScreen ? "Shown in preview / export (click to hide)" : "Hidden from preview / export (click to show)"}
          >
            {onScreen ? "◉" : "◌"}
          </button>
        )}
        <button className="ghost" onClick={del} title="Delete track">
          ✕
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ clip

/** Source time of a clip's first frame, nudged in so the frame has decoded content. */
const thumbSeconds = (clip: Clip, fps: number) => (clip.offset ? tcToFrames(clip.offset, fps) / fps : 0) + 0.05;

type DragMode = "move" | "start" | "end";

function snapCandidates(ref: ClipRef): number[] {
  const { project, playhead } = useStore.getState();
  const fps = project!.settings.fps;
  const out = [0, playhead];
  for (const t of project!.tracks) {
    for (const c of t.clips) {
      if (t.id === ref.trackId && c.id === ref.clipId) continue;
      out.push(startF(c, fps), endF(c, fps));
    }
  }
  return out;
}

function nearest(cands: number[], f: number, maxDist: number): number | null {
  let best: number | null = null;
  for (const c of cands) if (Math.abs(c - f) <= maxDist && (best === null || Math.abs(c - f) < Math.abs(best - f))) best = c;
  return best;
}

type ClipProps = { track: Track; clip: Clip; fps: number; ppf: number; selected: boolean; onSnap: (f: number | null) => void };

function ClipView({ track, clip, fps, ppf, selected, onSnap }: ClipProps) {
  const dir = useStore((s) => s.dir)!;
  const s = startF(clip, fps);
  const e = endF(clip, fps);
  const w = Math.max(2, (e - s) * ppf);
  const ref = clipThumbRef(track, clip);
  const kind = mediaKind(ref);
  const url = useMemo(() => (ref ? assetUrl(dir, ref) : null), [dir, ref]);

  const startDrag = (ev: React.PointerEvent, mode: DragMode) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const st = useStore.getState();
    const cref = { trackId: track.id, clipId: clip.id };
    st.select(cref);
    st.begin();
    const x0 = ev.clientX;
    const dur = e - s;
    const cands = snapCandidates(cref);
    const maxDist = SNAP_PX / ppf;
    let moved = false;

    const move = (pe: PointerEvent) => {
      const df = Math.round((pe.clientX - x0) / ppf);
      if (!moved && Math.abs(pe.clientX - x0) < 3) return;
      moved = true;
      if (mode === "move") {
        let ns = s + df;
        const a = nearest(cands, ns, maxDist);
        const b = nearest(cands, ns + dur, maxDist);
        let line: number | null = null;
        if (a !== null && (b === null || Math.abs(a - ns) <= Math.abs(b - ns - dur))) {
          ns = a;
          line = a;
        } else if (b !== null) {
          ns = b - dur;
          line = b;
        }
        onSnap(line);
        useStore.getState().editFromBase((d) => moveClip(d, cref, Math.max(0, ns), pe.altKey));
      } else {
        let nf = (mode === "start" ? s : e) + df;
        const snapped = nearest(cands, nf, maxDist);
        if (snapped !== null) nf = snapped;
        onSnap(snapped);
        const ripple = mode === "end" && pe.altKey;
        useStore.getState().editFromBase((d) => trimClip(d, cref, mode, nf, ripple));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onSnap(null);
      useStore.getState().commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`clip ${selected ? "selected" : ""}`}
      style={{ left: s * ppf, width: w }}
      title={`${framesToTc(s, fps)} → ${framesToTc(e, fps)} (${formatDuration(e - s, fps)})`}
      onPointerDown={(ev) => startDrag(ev, "move")}
      onDoubleClick={(ev) => {
        ev.stopPropagation();
        seek(s);
      }}
    >
      {track.kind === "audio" && url && kind === "audio" && <Waveform url={url} clip={clip} fps={fps} widthPx={w} />}
      {track.kind !== "audio" && url && kind === "image" && w > 40 && <img className="thumb" src={url} alt="" draggable={false} />}
      {track.kind !== "audio" && url && kind === "video" && w > 40 && (
        // The first frame the clip plays (its source offset); the media fragment makes the element show it.
        <video className="thumb" src={`${url}#t=${thumbSeconds(clip, fps).toFixed(2)}`} muted preload="metadata" />
      )}
      {kind === "video" && <div className="clip-label">🎞</div>}
      <div className="edge l" onPointerDown={(ev) => startDrag(ev, "start")} />
      <div className="edge r" onPointerDown={(ev) => startDrag(ev, "end")} />
    </div>
  );
}

/** Shown instead of track rows in an empty project. */
export function NoTracks() {
  return (
    <div className="no-tracks">
      <div className="dim">No tracks yet</div>
      <button className="primary" onClick={() => useStore.setState({ addTrackOpen: true })}>
        ＋Add track
      </button>
    </div>
  );
}
