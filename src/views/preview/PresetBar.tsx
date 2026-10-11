import { useState } from "react";
import { currentPreset, useStore } from "../../store/store";
import { PresetSettingsDialog } from "./PresetSettingsDialog";
import { addPreset, deletePreset, selectPreset } from "./presets";

/**
 * Preset (composition) selector shared by the preview header and the export dialog:
 * [preset ▾] [＋] [✎ settings] [✕]. Changes are saved with the project automatically.
 */
export function PresetBar() {
  const presets = useStore((s) => s.project!.exportPresets);
  const current = useStore(currentPreset);
  const [editing, setEditing] = useState(false);

  return (
    <div className="preset-bar">
      <select
        value={current?.id ?? ""}
        onChange={(e) => selectPreset(e.target.value)}
        title="Preview / export preset. Visible tracks: ◉ in the timeline track headers."
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="icon" onClick={() => addPreset()} title="New preset (every visual track shown)">
        ＋
      </button>
      {current && (
        <button
          className="icon"
          onClick={() => setEditing(true)}
          title={`Settings of "${current.name}" (name, resolution, bitrate, captions…)`}
        >
          ✎
        </button>
      )}
      {editing && <PresetSettingsDialog onClose={() => setEditing(false)} />}
      {current && presets.length > 1 && (
        <button className="ghost icon" onClick={() => deletePreset(current.id)} title={`Delete preset "${current.name}"`}>
          ✕
        </button>
      )}
    </div>
  );
}
