/**
 * Preview / export presets work like compositions in After Effects: they are part of the project,
 * edits apply to the selected one directly, and they are saved with the project.
 *
 * A preset decides what is shown, independently of the other presets:
 * - `screens`: the visual tracks drawn (in timeline order)
 * - `columns[trackId]`: which extra media columns are drawn as insets and which text columns are captions
 * so one set of tables can be exported as several differently captioned videos.
 * The first column of every track (Reference) is its media and is always the picture.
 */
import type { ExportPreset, PresetColumns, Project, Track } from "./schema";

const visualTracks = (p: Project) => p.tracks.filter((t) => t.kind === "visual");

/** Key of the track's required first column (Reference): the picture / audio file of each row. */
export const mainKey = (t: Track): string | null => (t.fields[0]?.type === "media" ? t.fields[0].key : null);

/** Default display of a track: the picture only, no insets or captions. */
export function defaultColumns(_t: Track): PresetColumns {
  return { insets: [], captions: [] };
}

/** A preset showing every visual track with default columns. */
export function defaultPreset(p: Project, id: string, name: string): ExportPreset {
  const tracks = visualTracks(p);
  return {
    id,
    name,
    video: { bitrate: 8_000_000, bitrateMode: "variable" },
    audio: { enabled: true, bitrate: 192_000 },
    layout: tracks.length > 1 ? "grid" : "single",
    screens: tracks.map((t) => t.id),
    columns: Object.fromEntries(tracks.map((t) => [t.id, defaultColumns(t)])),
    insetStyle: { position: "bottom-right", size: 20 },
    captionStyle: { position: "bottom", size: 4 },
    burnTimecode: true,
    showLabels: true,
  };
}

/** Next free default name for an added preset: "Preset 2", "Preset 3", ... (the first one is "Main"). */
export function nextPresetName(p: Project): string {
  const names = new Set(p.exportPresets.map((x) => x.name));
  for (let n = p.exportPresets.length + 1; ; n++) if (!names.has(`Preset ${n}`)) return `Preset ${n}`;
}

/** Adds a preset with default settings (every visual track shown); returns its id. */
export function addDefaultPreset(p: Project, name = nextPresetName(p)): string {
  const id = presetIdFor(p, name);
  p.exportPresets.push(defaultPreset(p, id, name));
  return id;
}

/** Projects always have at least one preset (the preview needs one to show); the first is "Main". */
export function ensurePreset(p: Project) {
  if (p.exportPresets.length === 0) addDefaultPreset(p, "Main");
}

/**
 * Keeps every preset consistent with the tracks: drops unknown tracks / columns and gives every
 * visual track a `columns` entry, so the file always states what each preset shows.
 */
export function syncPresets(p: Project) {
  const visual = visualTracks(p);
  const ids = new Set(visual.map((t) => t.id));
  for (const preset of p.exportPresets) {
    preset.screens = visual.filter((t) => preset.screens.includes(t.id)).map((t) => t.id);
    preset.layout = preset.screens.length > 1 ? "grid" : "single";
    for (const key of Object.keys(preset.columns)) if (!ids.has(key)) delete preset.columns[key];
    for (const t of visual) {
      const cols = preset.columns[t.id];
      if (!cols) {
        preset.columns[t.id] = defaultColumns(t);
        continue;
      }
      const extraMedia = t.fields.filter((f) => f.type === "media" && f.key !== mainKey(t)).map((f) => f.key);
      const text = t.fields.filter((f) => f.type === "text").map((f) => f.key);
      cols.insets = extraMedia.filter((k) => cols.insets.includes(k)); // column order
      cols.captions = text.filter((k) => cols.captions.includes(k));
    }
  }
}

/** Shows a new visual track in every preset (as adding a layer does). */
export function showTrackInAllPresets(p: Project, t: Track) {
  for (const preset of p.exportPresets) {
    if (!preset.screens.includes(t.id)) preset.screens.push(t.id);
    preset.columns[t.id] ??= defaultColumns(t);
  }
  syncPresets(p);
}

/** Visual tracks shown as screens, in track order. */
export function shownScreens(p: Project, preset: ExportPreset): string[] {
  return visualTracks(p)
    .filter((t) => preset.screens.includes(t.id))
    .map((t) => t.id);
}

/** Toggles one track on/off in a preset (mutates it); the layout follows the count. */
export function toggleScreen(p: Project, preset: ExportPreset, trackId: string) {
  const cur = shownScreens(p, preset);
  const next = cur.includes(trackId) ? cur.filter((id) => id !== trackId) : [...cur, trackId];
  preset.screens = p.tracks.filter((t) => next.includes(t.id)).map((t) => t.id);
  preset.layout = preset.screens.length > 1 ? "grid" : "single";
}

const columnsOf = (preset: ExportPreset | undefined, t: Track) => preset?.columns[t.id] ?? defaultColumns(t);

/** Keys of the extra media columns drawn as insets, in column order. */
export function insetKeys(preset: ExportPreset | undefined, t: Track): string[] {
  if (t.kind !== "visual") return [];
  const keys = columnsOf(preset, t).insets;
  return t.fields.filter((f) => f.type === "media" && f.key !== mainKey(t) && keys.includes(f.key)).map((f) => f.key);
}

/** Keys of the text columns burned in as captions, in column order. */
export function captionKeys(preset: ExportPreset | undefined, t: Track): string[] {
  if (t.kind !== "visual") return [];
  const keys = columnsOf(preset, t).captions;
  return t.fields.filter((f) => f.type === "text" && keys.includes(f.key)).map((f) => f.key);
}

/** ◉ on an extra media column: shows / hides it as an inset. */
export function toggleInset(preset: ExportPreset, t: Track, key: string) {
  preset.columns[t.id] ??= defaultColumns(t);
  const cols = preset.columns[t.id];
  cols.insets = cols.insets.includes(key) ? cols.insets.filter((k) => k !== key) : [...cols.insets, key];
  cols.insets = t.fields.filter((f) => cols.insets.includes(f.key)).map((f) => f.key);
}

/** ◉ on a text column: adds / removes it as a caption. */
export function toggleCaption(preset: ExportPreset, t: Track, key: string) {
  preset.columns[t.id] ??= defaultColumns(t);
  const cols = preset.columns[t.id];
  cols.captions = cols.captions.includes(key) ? cols.captions.filter((k) => k !== key) : [...cols.captions, key];
  cols.captions = t.fields.filter((f) => cols.captions.includes(f.key)).map((f) => f.key);
}

/** Preset id from a name ("Client review" → "client-review"), unique in the project. */
export function presetIdFor(p: Project, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "preset";
  const taken = new Set(p.exportPresets.map((x) => x.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
