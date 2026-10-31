import { useEffect, useRef } from "react";
import { assetUrl } from "../../io/backend";
import { projectEndFrame } from "../../model/ops";
import { framesToTc } from "../../model/timecode";
import { renderFrame, resolvePreset, type Visual } from "../../render/compositor";
import { getImage, isMediaPending, mediaKind, onMediaUpdate, pauseVideosExcept, syncVideo } from "../../render/media";
import { currentPreset, useStore } from "../../store/store";
import { PresetBar } from "./PresetBar";
import { seek, togglePlay } from "./player";

/** How long the previous frame stays up while waiting for media (a broken file must not freeze the preview). */
const MAX_HOLD_MS = 5000;

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Frames are composed off-screen and shown once their media is ready, so seeking never flashes black.
  const backRef = useRef<HTMLCanvasElement | null>(null);
  const waitingSince = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const project = useStore((s) => s.project)!;
  const dir = useStore((s) => s.dir)!;
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const preset = resolvePreset(project, useStore(currentPreset));
  const fps = project.settings.fps;
  const end = projectEndFrame(project);

  // Draw on every relevant change; media loads trigger a redraw through onMediaUpdate.
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== preset.width) canvas.width = preset.width;
    if (canvas.height !== preset.height) canvas.height = preset.height;
    backRef.current ??= document.createElement("canvas");
    const back = backRef.current;
    if (back.width !== preset.width) back.width = preset.width;
    if (back.height !== preset.height) back.height = preset.height;
    const activeVideos = new Set<string>();
    let waiting = false;
    renderFrame(back.getContext("2d")!, project, preset, playhead, (ref, seconds): Visual | null => {
      const url = assetUrl(dir, ref);
      let visual: Visual | null;
      if (mediaKind(ref) === "image") visual = getImage(url);
      else {
        activeVideos.add(url);
        visual = syncVideo(url, seconds, playing);
      }
      if (!visual && isMediaPending(url)) waiting = true;
      return visual;
    });
    pauseVideosExcept(activeVideos);

    clearTimeout(holdTimer.current);
    if (waiting) {
      // Keep showing the previous frame; onMediaUpdate redraws when the media arrives.
      waitingSince.current ??= performance.now();
      const left = MAX_HOLD_MS - (performance.now() - waitingSince.current);
      if (left > 0) {
        holdTimer.current = setTimeout(() => drawRef.current(), left);
        return;
      }
    } else {
      waitingSince.current = null;
    }
    canvas.getContext("2d")!.drawImage(back, 0, 0);
  };

  useEffect(() => {
    drawRef.current();
  });

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  useEffect(() => {
    let pending = 0;
    return onMediaUpdate(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => drawRef.current());
    });
  }, []);

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label">Preview</span>
        <PresetBar />
        <span className="dim small">
          {preset.width}×{preset.height}
        </span>
      </div>
      <div className="pane-body">
        <div className="preview-stage">
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div className="transport">
        <button className="icon" onClick={() => seek(0)} title="Start (Home)">
          ⏮
        </button>
        <button className="icon" onClick={() => seek(playhead - 1)} title="Previous frame (←)">
          ◀
        </button>
        <button className="icon" onClick={togglePlay} title="Play/stop (Space)" style={{ minWidth: 40 }}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="icon" onClick={() => seek(playhead + 1)} title="Next frame (→)">
          ▶|
        </button>
        <button className="icon" onClick={() => seek(end)} title="End (End)">
          ⏭
        </button>
        <span className="tc tc-big">{framesToTc(playhead, fps)}</span>
        <span className="tc dim">/ {framesToTc(end, fps)}</span>
      </div>
    </div>
  );
}
