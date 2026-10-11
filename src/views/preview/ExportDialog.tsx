import { useState } from "react";
import { joinPath, revealPath } from "../../io/backend";
import { saveNow } from "../../io/project";
import { safeFileName, timestamp } from "../../io/textio";
import { resolvePreset } from "../../render/compositor";
import { type CancelToken, type ExportProgress, exportMp4 } from "../../render/exporter";
import { currentPreset, useStore } from "../../store/store";
import { stop } from "./player";

/** File ▸ Export video…: pick a preset and render it as an H.264 mp4 (settings live in the preset, ✎). */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const dir = useStore((s) => s.dir)!;
  const [presetId, setPresetId] = useState(() => currentPreset(useStore.getState())?.id ?? "");
  const preset = project.exportPresets.find((p) => p.id === presetId) ?? project.exportPresets[0];
  const resolved = resolvePreset(project, preset);
  const screenNames = resolved.screens.map((id) => project.tracks.find((t) => t.id === id)?.name ?? id);

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [token, setToken] = useState<CancelToken | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = !!token;

  const run = async () => {
    stop();
    await saveNow();
    const t: CancelToken = { cancelled: false };
    setToken(t);
    setResult(null);
    setError(null);
    const out = joinPath(dir, `exports/${safeFileName(preset.name)}_${timestamp()}.mp4`);
    try {
      const p = useStore.getState().project!;
      await exportMp4(
        p,
        resolvePreset(
          p,
          p.exportPresets.find((x) => x.id === preset.id),
        ),
        dir,
        out,
        setProgress,
        t,
      );
      setResult(out);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setToken(null);
      setProgress(null);
    }
  };

  return (
    <div className="modal-back" onPointerDown={(e) => !busy && e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-head">Export video (H.264 mp4)</div>
        <div className="modal-body">
          <div className="form">
            <label>Preset</label>
            <select value={preset.id} disabled={busy} onChange={(e) => setPresetId(e.target.value)}>
              {project.exportPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label>Output</label>
            <div className="dim small">
              {screenNames.length ? screenNames.join(", ") : <span style={{ color: "var(--danger)" }}>No track is shown</span>}
              <br />
              {resolved.width}×{resolved.height} / {resolved.fps} fps / {resolved.video.bitrate / 1_000_000} Mbps
              {resolved.audio.enabled ? " / with audio" : ""}
              <br />
              Change these with ✎ next to the preset in the preview.
            </div>
          </div>
        </div>
        <div className="modal-foot">
          {busy && progress && (
            <>
              <span className="small">{progress.phase}</span>
              <div className="progress">
                <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <span className="small tc">
                {progress.done}/{progress.total}
              </span>
              <button onClick={() => (token!.cancelled = true)}>Cancel</button>
            </>
          )}
          {!busy && result && (
            <>
              <span className="small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }} title={result}>
                ✓ {result}
              </span>
              <button onClick={() => revealPath(result)}>Show in folder</button>
            </>
          )}
          {!busy && error && (
            <span className="small" style={{ flex: 1, color: "var(--danger)" }}>
              {error}
            </span>
          )}
          {!busy && !result && !error && <div className="spacer" />}
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" onClick={run} disabled={busy || !resolved.screens.length}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
