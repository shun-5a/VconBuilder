import { normalizeProject } from "./ops";
import type { Project as ProjectT } from "./schema";
import { Project } from "./schema";

/** Arrays under these keys are written one element per line, so the file reads like a table and diffs per row. */
const ROW_ARRAYS = new Set(["clips", "fields"]);

function write(value: unknown, indent: string, key: string | null): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = `${indent}  `;
    const items = value.map((v) => (key && ROW_ARRAYS.has(key) ? JSON.stringify(v) : write(v, inner, null)));
    if (items.every((s) => !s.includes("\n")) && items.join(", ").length < 80 && !(key && ROW_ARRAYS.has(key))) {
      return `[${items.join(", ")}]`;
    }
    return `[\n${items.map((s) => inner + s).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    // Entries of a preset's `columns` map stay on one line each: "track": {"insets":[…],"captions":[…]}
    const value1 = (k: string, v: unknown) => (key === "columns" ? JSON.stringify(v) : write(v, inner, k));
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${value1(k, v)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const CLIP_HEAD = ["start", "end", "offset"];

/** Clip keys in a stable order: timing first, then the track's columns in table order, then anything else. */
function orderClipKeys(track: ProjectT["tracks"][number]) {
  const order = [...CLIP_HEAD, ...track.fields.map((f) => f.key)];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return {
    ...track,
    // Clip ids are internal (assigned on load), so they are not written.
    clips: track.clips.map((c) =>
      Object.fromEntries(
        Object.entries(c)
          .filter(([k]) => k !== "id")
          .sort(([a], [b]) => rank(a) - rank(b)),
      ),
    ),
  };
}

export function serializeProject(p: ProjectT): string {
  return `${write({ ...p, tracks: p.tracks.map(orderClipKeys) }, "", null)}\n`;
}

type RawField = { key?: string; label?: string; type?: string; show?: boolean };
type RawTrack = { id?: string; kind?: string; fields?: RawField[]; clips?: Record<string, unknown>[]; solo?: unknown };
type RawCaption = { track?: string; field?: string; position?: string; size?: number };
type RawPreset = Record<string, unknown> & {
  captions?: RawCaption[];
  captionStyle?: unknown;
  screens?: unknown[];
  columns?: Record<string, { picture?: string | null; insets?: string[]; captions: string[] }>;
};

/**
 * Upgrades files written by earlier versions:
 * - the former "cue" track kind is now a visual track
 * - audio solo and clip gain / fades were removed (dropped unless a column uses the key)
 * - the default audio column "Source" is now "Reference"
 * - the first media column is always the picture; a preset that picked another media column as its
 *   picture (`columns.*.picture`) now shows that column as an inset
 * - the automatic "Default" preset is dropped unless it was customised
 * - picture / caption choices moved from flags on the columns (fields[].show) and preset caption
 *   lists into each preset's `columns`; a missing `screens` list meant "every visual track"
 */
function migrate(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const doc = json as { tracks?: RawTrack[]; exportPresets?: RawPreset[] };
  const tracks = Array.isArray(doc.tracks) ? doc.tracks.filter((t) => t && typeof t === "object") : [];
  for (const t of tracks) if (t.kind === "cue") t.kind = "visual";
  const fieldsOf = (t: RawTrack) => (Array.isArray(t.fields) ? t.fields.filter((f) => f && typeof f === "object") : []);
  const visual = tracks.filter((t) => t.kind !== "audio" && t.kind !== "text");
  for (const t of tracks) {
    delete t.solo;
    // Default audio column was labelled "Source" before it matched the visual tracks' "Reference".
    if (t.kind === "audio") for (const f of fieldsOf(t)) if (f.key === "ref" && f.label === "Source") f.label = "Reference";
    const keys = new Set(fieldsOf(t).map((f) => f.key));
    for (const c of Array.isArray(t.clips) ? t.clips : [])
      for (const k of ["gain", "fadeIn", "fadeOut"]) if (c && typeof c === "object" && !keys.has(k)) delete c[k];
  }

  if (Array.isArray(doc.exportPresets)) {
    doc.exportPresets = doc.exportPresets.filter((x) => {
      if (x?.id !== "default" || x.name !== "Default") return true;
      const style = x.captionStyle as { position?: string; size?: number } | undefined;
      const untouched =
        (!x.screens || x.screens.length === 0) &&
        x.width === undefined &&
        x.height === undefined &&
        x.fps === undefined &&
        (!style || (style.position === "bottom" && style.size === 4));
      return !untouched;
    });
  }
  const presets = Array.isArray(doc.exportPresets) ? doc.exportPresets.filter((x) => x && typeof x === "object") : [];

  // Oldest format: caption lists on presets (only for that preset; merged into its columns below).
  const listed = new Map<RawPreset, Map<string, string[]>>();
  for (const preset of presets) {
    if (!Array.isArray(preset.captions)) continue;
    const byTrack = new Map<string, string[]>();
    for (const cap of preset.captions) {
      const field = tracks.find((t) => t.id === cap?.track)?.fields?.find((x) => x?.key === cap?.field);
      if (field && field.type !== "media") byTrack.set(cap.track!, [...(byTrack.get(cap.track!) ?? []), field.key!]);
    }
    listed.set(preset, byTrack);
    const first = preset.captions[0];
    if (first && !preset.captionStyle) preset.captionStyle = { position: first.position ?? "bottom", size: first.size ?? 4 };
    delete preset.captions;
  }

  // Column flags (fields[].show) → each preset's columns.
  const flagged = (t: RawTrack) => {
    const media = fieldsOf(t).filter((x) => x.type === "media");
    const shown = media.find((x) => x.show === true);
    const picture = shown?.key ?? (media.every((x) => x.show === undefined) ? (media[0]?.key ?? null) : null);
    const captions = fieldsOf(t)
      .filter((x) => x.type !== "media" && x.show === true)
      .map((x) => x.key!);
    return { picture, captions };
  };
  for (const preset of presets) {
    if (!preset.columns || typeof preset.columns !== "object") {
      preset.columns = Object.fromEntries(
        visual.map((t) => {
          const cols = flagged(t);
          const extra = listed.get(preset)?.get(t.id!) ?? [];
          return [t.id!, { ...cols, captions: [...extra, ...cols.captions.filter((k) => !extra.includes(k))] }];
        }),
      );
    }
    if (!Array.isArray(preset.screens)) preset.screens = visual.map((t) => t.id);
  }
  for (const t of tracks) for (const x of fieldsOf(t)) delete x.show;

  for (const preset of presets) {
    for (const [id, cols] of Object.entries(preset.columns ?? {})) {
      if (!cols || typeof cols !== "object" || !("picture" in cols)) continue;
      const main = fieldsOf(tracks.find((t) => t.id === id) ?? {}).find((x) => x.type === "media")?.key;
      if (!Array.isArray(cols.insets)) cols.insets = cols.picture && cols.picture !== main ? [cols.picture] : [];
      delete cols.picture;
    }
  }

  // A short-lived version stored virtual folders; they become groups (nested paths flattened).
  const raw = json as { assetFolders?: { folders?: string[]; files?: Record<string, string> }; assetGroups?: unknown };
  if (raw.assetFolders && !raw.assetGroups) {
    const name = (path: string) => path.split("/").join(" / ");
    raw.assetGroups = {
      groups: (raw.assetFolders.folders ?? []).map(name),
      files: Object.fromEntries(Object.entries(raw.assetFolders.files ?? {}).map(([rel, f]) => [rel, name(f)])),
    };
  }
  delete raw.assetFolders;
  return json;
}

export type ParseResult = { ok: true; project: ProjectT } | { ok: false; error: string };

export function parseProject(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON syntax error: ${(e as Error).message}` };
  }
  const r = Project.safeParse(migrate(json));
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    return { ok: false, error: `Schema error:\n${msg}` };
  }
  normalizeProject(r.data);
  return { ok: true, project: r.data };
}
