/**
 * Preset (composition) actions. Presets are part of the project like comps in After Effects:
 * every change is an ordinary, undoable project edit and is saved with the project.
 */

import { addDefaultPreset, toggleScreen } from "../../model/preview";
import type { ExportPreset } from "../../model/schema";
import { currentPreset, useStore } from "../../store/store";

/** Edits the preset shown in the preview. */
export function updatePreview(fn: (p: ExportPreset) => void) {
  const id = currentPreset(useStore.getState())?.id;
  if (!id) return;
  useStore.getState().edit((d) => {
    const p = d.exportPresets.find((x) => x.id === id);
    if (p) fn(p);
  });
}

/** Shows/hides a visual track in the current preset (◉ in the timeline track header). */
export function toggleTrackOnScreen(trackId: string) {
  const project = useStore.getState().project;
  if (project) updatePreview((p) => toggleScreen(project, p, trackId));
}

export function selectPreset(id: string) {
  useStore.setState({ presetId: id });
}

/** Adds a preset with default settings (every visual track shown) and switches to it. */
export function addPreset(name?: string) {
  let id = "";
  useStore.getState().edit((d) => {
    id = addDefaultPreset(d, name?.trim() || undefined);
  });
  useStore.setState({ presetId: id });
}

export function renamePreset(id: string, name: string) {
  if (!name.trim()) return;
  useStore.getState().edit((d) => {
    const p = d.exportPresets.find((x) => x.id === id);
    if (p) p.name = name.trim();
  });
}

/** Deletes a preset; the last one cannot be deleted (the preview always needs one). */
export function deletePreset(id: string) {
  const { project } = useStore.getState();
  if (!project || project.exportPresets.length <= 1) return;
  useStore.getState().edit((d) => {
    d.exportPresets = d.exportPresets.filter((p) => p.id !== id);
  });
  useStore.setState({ presetId: useStore.getState().project!.exportPresets[0].id });
}
