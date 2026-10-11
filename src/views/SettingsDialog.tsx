import { useState } from "react";
import { changeFps } from "../model/ops";
import { useStore } from "../store/store";

export const RESOLUTION_PRESETS: [string, number, number][] = [
  ["FHD 1920×1080", 1920, 1080],
  ["4K UHD 3840×2160", 3840, 2160],
  ["HD 1280×720", 1280, 720],
  ["Vertical 1080×1920", 1080, 1920],
  ["Square 1080×1080", 1080, 1080],
];
export const FPS_PRESETS = [24, 25, 30, 50, 60];

export function ResolutionInput({ width, height, onChange }: { width: number; height: number; onChange: (w: number, h: number) => void }) {
  const match = RESOLUTION_PRESETS.find(([, w, h]) => w === width && h === height);
  return (
    <div className="row">
      <select
        value={match ? `${width}x${height}` : "custom"}
        onChange={(e) => {
          const p = RESOLUTION_PRESETS.find(([, w, h]) => `${w}x${h}` === e.target.value);
          if (p) onChange(p[1], p[2]);
        }}
      >
        {RESOLUTION_PRESETS.map(([label, w, h]) => (
          <option key={label} value={`${w}x${h}`}>
            {label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      <input
        type="number"
        min={16}
        max={8192}
        step={2}
        value={width}
        style={{ width: 80 }}
        onChange={(e) => onChange(Number(e.target.value), height)}
      />
      ×
      <input
        type="number"
        min={16}
        max={8192}
        step={2}
        value={height}
        style={{ width: 80 }}
        onChange={(e) => onChange(width, Number(e.target.value))}
      />
      {(width % 2 !== 0 || height % 2 !== 0) && <span style={{ color: "var(--danger)" }}>H.264 needs even sizes</span>}
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.project!.settings);
  const edit = useStore((s) => s.edit);
  const [w, setW] = useState(settings.width);
  const [h, setH] = useState(settings.height);
  const [fps, setFps] = useState(settings.fps);

  const apply = () => {
    edit((d) => {
      if (fps !== d.settings.fps) changeFps(d, fps);
      d.settings.width = Math.max(16, Math.round(w));
      d.settings.height = Math.max(16, Math.round(h));
    });
    onClose();
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-head">Project settings</div>
        <div className="modal-body">
          <div className="form">
            <label>Resolution</label>
            <ResolutionInput
              width={w}
              height={h}
              onChange={(a, b) => {
                setW(a);
                setH(b);
              }}
            />
            <label>Frame rate</label>
            <div className="row">
              <select
                value={FPS_PRESETS.includes(fps) ? fps : "custom"}
                onChange={(e) => e.target.value !== "custom" && setFps(Number(e.target.value))}
              >
                {FPS_PRESETS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <input
                type="number"
                min={1}
                max={120}
                value={fps}
                style={{ width: 70 }}
                onChange={(e) => setFps(Math.max(1, Math.round(Number(e.target.value))))}
              />
            </div>
          </div>
          {fps !== settings.fps && <p className="dim small">Changing fps converts every clip timecode, keeping positions in seconds.</p>}
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
