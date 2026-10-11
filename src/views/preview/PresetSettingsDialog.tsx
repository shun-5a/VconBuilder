import { useEffect, useState } from "react";
import type { InsetPosition } from "../../model/schema";
import { resolvePreset } from "../../render/compositor";
import { currentPreset, useStore } from "../../store/store";
import { NumberField } from "../NumberField";
import { FPS_PRESETS, ResolutionInput } from "../SettingsDialog";
import { renamePreset, updatePreview } from "./presets";

/**
 * ✎ in the preview header: the current preset's name and output settings. Changes apply
 * immediately (like editing a composition in After Effects) and can be undone with Ctrl+Z.
 */
export function PresetSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const preset = useStore(currentPreset)!;
  const resolved = resolvePreset(project, preset);
  const [name, setName] = useState(preset.name);
  const customRes = preset.width !== undefined || preset.height !== undefined;
  const screenNames = resolved.screens.map((id) => project.tracks.find((t) => t.id === id)?.name ?? id);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the field when another preset is shown, too
  useEffect(() => setName(preset.name), [preset.id, preset.name]);
  const commitName = () => (name.trim() && name.trim() !== preset.name ? renamePreset(preset.id, name) : setName(preset.name));

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-head">Preset settings</div>
        <div className="modal-body">
          <div className="form">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />

            <label>Shows</label>
            <div>
              {screenNames.length ? screenNames.join(", ") : <span style={{ color: "var(--danger)" }}>No track is shown</span>}
              <div className="dim small">
                Tracks: ◉ in the timeline track headers. Picture and caption columns: ◉ in the Conte table headers. Both are saved in this
                preset.
              </div>
            </div>

            <label>Resolution</label>
            <div>
              <label className="row small">
                <input
                  type="checkbox"
                  checked={customRes}
                  onChange={(e) =>
                    updatePreview((p) => {
                      if (e.target.checked) {
                        p.width = project.settings.width;
                        p.height = project.settings.height;
                      } else {
                        delete p.width;
                        delete p.height;
                      }
                    })
                  }
                />
                Override project resolution ({project.settings.width}×{project.settings.height})
              </label>
              {customRes && (
                <ResolutionInput
                  width={resolved.width}
                  height={resolved.height}
                  onChange={(w, h) =>
                    updatePreview((p) => {
                      p.width = w;
                      p.height = h;
                    })
                  }
                />
              )}
            </div>

            <label>Frame rate</label>
            <div className="row">
              <select
                value={preset.fps ?? ""}
                onChange={(e) =>
                  updatePreview((p) => {
                    if (e.target.value) p.fps = Number(e.target.value);
                    else delete p.fps;
                  })
                }
              >
                <option value="">Same as project ({project.settings.fps} fps)</option>
                {FPS_PRESETS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>

            <label>Video bitrate</label>
            <div className="row">
              <NumberField
                min={0.1}
                max={500}
                step={0.5}
                width={80}
                value={preset.video.bitrate / 1_000_000}
                onCommit={(v) =>
                  updatePreview((p) => {
                    p.video.bitrate = Math.round(v * 1_000_000);
                  })
                }
              />
              Mbps
              <select
                value={preset.video.bitrateMode}
                onChange={(e) =>
                  updatePreview((p) => {
                    p.video.bitrateMode = e.target.value as "variable" | "constant";
                  })
                }
              >
                <option value="variable">VBR (variable)</option>
                <option value="constant">CBR (constant)</option>
              </select>
            </div>

            <label>Audio</label>
            <div className="row">
              <label className="row">
                <input
                  type="checkbox"
                  checked={preset.audio.enabled}
                  onChange={(e) =>
                    updatePreview((p) => {
                      p.audio.enabled = e.target.checked;
                    })
                  }
                />
                Mix audio tracks into the file (AAC)
              </label>
              <NumberField
                min={32}
                max={512}
                integer
                step={32}
                value={preset.audio.bitrate / 1000}
                onCommit={(v) =>
                  updatePreview((p) => {
                    p.audio.bitrate = v * 1000;
                  })
                }
              />
              kbps
            </div>

            <label>Captions</label>
            <div className="row">
              <select
                value={preset.captionStyle.position}
                onChange={(e) =>
                  updatePreview((p) => {
                    p.captionStyle.position = e.target.value as "top" | "center" | "bottom";
                  })
                }
              >
                <option value="bottom">Bottom</option>
                <option value="center">Center</option>
                <option value="top">Top</option>
              </select>
              <NumberField
                min={0.5}
                max={20}
                step={0.5}
                width={60}
                value={preset.captionStyle.size}
                title="Font size (% of screen height)"
                onCommit={(v) =>
                  updatePreview((p) => {
                    p.captionStyle.size = v;
                  })
                }
              />
              <span className="dim small">% of screen height</span>
            </div>

            <label>Insets</label>
            <div className="row">
              <select
                value={preset.insetStyle.position}
                title="Corner for the media columns switched on with ◉ (several stack away from the corner)"
                onChange={(e) =>
                  updatePreview((p) => {
                    p.insetStyle.position = e.target.value as InsetPosition;
                  })
                }
              >
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
              </select>
              <NumberField
                min={5}
                max={50}
                step={1}
                width={60}
                value={preset.insetStyle.size}
                title="Inset width (% of screen width)"
                onCommit={(v) =>
                  updatePreview((p) => {
                    p.insetStyle.size = v;
                  })
                }
              />
              <span className="dim small">% of screen width</span>
            </div>

            <label>Overlays</label>
            <div className="row">
              <label className="row">
                <input
                  type="checkbox"
                  checked={preset.burnTimecode}
                  onChange={(e) =>
                    updatePreview((p) => {
                      p.burnTimecode = e.target.checked;
                    })
                  }
                />
                Timecode (top right)
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={preset.showLabels}
                  onChange={(e) =>
                    updatePreview((p) => {
                      p.showLabels = e.target.checked;
                    })
                  }
                />
                Track names in grid
              </label>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="dim small">Changes are applied immediately (Ctrl+Z to undo).</span>
          <div className="spacer" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
