import { ensurePreset } from "./preview";
import type { Project } from "./schema";

/** A new project: no tracks, one preset ("Main"). */
export function emptyProject(): Project {
  const p: Project = {
    version: 1,
    settings: { fps: 30, width: 1920, height: 1080 },
    tracks: [],
    exportPresets: [],
    assetGroups: { groups: [], files: {} },
  };
  ensurePreset(p);
  return p;
}
