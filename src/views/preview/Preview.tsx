import { useEffect, useRef } from "react";
import { assetUrl } from "../../io/backend";
import { projectEndFrame } from "../../model/ops";
import { framesToTc } from "../../model/timecode";
import { renderFrame, resolvePreset, type Visual } from "../../render/compositor";
import { getImage, mediaKind, onMediaUpdate, pauseVideosExcept, syncVideo } from "../../render/media";
import { currentPreset, useStore } from "../../store/store";
import { PresetBar } from "./PresetBar";
import { seek, togglePlay } from "./player";

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const ctx = canvas.getContext("2d")!;
    const activeVideos = new Set<string>();
    renderFrame(ctx, project, preset, playhead, (ref, seconds): Visual | null => {
      const url = assetUrl(dir, ref);
      if (mediaKind(ref) === "image") return getImage(url);
      activeVideos.add(url);
      return syncVideo(url, seconds, playing);
    });
    pauseVideosExcept(activeVideos);
  };

  useEffect(() => {
    drawRef.current();
  });

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
