import { z } from "zod";

/** Non-drop-frame timecode `HH:MM:SS:FF`. */
export const TC_PATTERN = /^\d{2,}:\d{2}:\d{2}:\d{2}$/;
const Timecode = z.string().regex(TC_PATTERN).describe("Timecode HH:MM:SS:FF (non-drop-frame, at settings.fps)");

const Id = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

export const FieldType = z.enum(["text", "media"]);

/** Clip properties the app uses itself; a column with one of these keys would overwrite them. */
export const RESERVED_FIELD_KEYS = ["id", "start", "end", "offset"];

export const Field = z.object({
  key: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .refine((k) => !RESERVED_FIELD_KEYS.includes(k), { message: `must not be one of ${RESERVED_FIELD_KEYS.join(", ")}` })
    .describe("Property name used on each clip"),
  label: z.string().describe("Column title shown in the table"),
  type: FieldType.default("text").describe("text: free text / media: project-relative path to an asset"),
  width: z.number().positive().optional().describe("Column width in px (UI only)"),
});

/** Values a clip may carry for its track's fields. */
const CellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const Clip = z
  .object({
    // Not stored in the file: assigned on load and used only inside the app to identify rows.
    id: z.string().default(""),
    start: Timecode.describe("In point (inclusive)"),
    end: Timecode.describe("Out point (exclusive)"),
    offset: Timecode.optional().describe("Audio/video: position in the source media where playback starts"),
  })
  .catchall(CellValue)
  .describe("One cut / cue / row. Field values are stored as extra properties keyed by field.key");

export const TrackKind = z.enum(["visual", "audio", "text"]);

/** Look of a text track: drawn over the whole frame (across all screens). */
export const TextStyle = z.object({
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  size: z.number().positive().max(50).default(5).describe("Font size in % of the frame height"),
});

export const Track = z.object({
  id: Id,
  name: z.string(),
  kind: TrackKind.describe(
    "visual: images and videos (picture, lighting references, ...) / audio: audio files only / text: text drawn over the whole frame",
  ),
  fields: z
    .array(Field)
    .default([])
    .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, { message: "field keys must be unique within a track" })
    .describe("Table columns for this track"),
  clips: z.array(Clip).default([]).describe("Clips sorted by start; clips on one track never overlap"),
  mute: z.boolean().optional(),
  volume: z.number().optional().describe("Audio: track volume in dB"),
  textStyle: TextStyle.optional().describe("Text tracks: position and size (default bottom, 5%)"),
});

export const Settings = z.object({
  fps: z.number().int().min(1).max(120).default(30),
  width: z.number().int().min(16).max(8192).default(1920),
  height: z.number().int().min(16).max(8192).default(1080),
});

export const CaptionPosition = z.enum(["top", "center", "bottom"]);

export const CaptionStyle = z.object({
  position: CaptionPosition.default("bottom"),
  size: z.number().positive().default(4).describe("Font size in % of the screen height"),
});

export const PresetColumns = z.object({
  insets: z
    .array(z.string())
    .default([])
    .describe("Extra media column keys drawn as small insets over the picture (the first column is always the picture)"),
  captions: z.array(z.string()).default([]).describe("Text column keys burned in as captions, top to bottom"),
});

export const InsetPosition = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);

export const InsetStyle = z.object({
  position: InsetPosition.default("bottom-right").describe("Corner of the screen; several insets stack away from it"),
  size: z.number().positive().max(100).default(20).describe("Inset width in % of the screen width"),
});

export const ExportPreset = z.object({
  id: Id,
  name: z.string(),
  width: z.number().int().min(16).max(8192).optional().describe("Defaults to settings.width"),
  height: z.number().int().min(16).max(8192).optional().describe("Defaults to settings.height"),
  fps: z.number().int().min(1).max(120).optional().describe("Defaults to settings.fps"),
  video: z
    .object({
      bitrate: z.number().int().positive().default(8_000_000).describe("bits per second"),
      bitrateMode: z.enum(["variable", "constant"]).default("variable"),
    })
    .default({ bitrate: 8_000_000, bitrateMode: "variable" }),
  audio: z
    .object({
      enabled: z.boolean().default(true),
      bitrate: z.number().int().positive().default(192_000),
    })
    .default({ enabled: true, bitrate: 192_000 }),
  layout: z.enum(["single", "grid"]).default("single").describe("grid: show several screens side by side"),
  screens: z.array(z.string()).default([]).describe("Visual track ids drawn as screens, in track order"),
  overlays: z.array(z.string()).default([]).describe("Text track ids drawn over the whole frame, in track order"),
  columns: z
    .record(z.string(), PresetColumns)
    .default({})
    .describe("Per visual track: which extra media columns are insets and which text columns are captions"),
  insetStyle: InsetStyle.default({ position: "bottom-right", size: 20 }).describe("Placement of the insets"),
  captionStyle: CaptionStyle.default({ position: "bottom", size: 4 }).describe("Look of the captions"),
  burnTimecode: z.boolean().default(true),
  showLabels: z.boolean().default(true).describe("Show track names on screens in grid layout"),
});

export const AssetGroups = z.object({
  groups: z.array(z.string()).default([]).describe("Group names, in display order"),
  files: z.record(z.string(), z.string()).default({}).describe("Asset path → group name; assets not listed are ungrouped"),
});

export const Project = z.object({
  version: z.literal(1).default(1),
  settings: Settings.default({ fps: 30, width: 1920, height: 1080 }),
  tracks: z.array(Track).default([]),
  exportPresets: z.array(ExportPreset).default([]),
  assetGroups: AssetGroups.default({ groups: [], files: {} }).describe("Groups of the Assets tab (files are not moved)"),
});

export type FieldType = z.infer<typeof FieldType>;
export type Field = z.infer<typeof Field>;
export type Clip = z.infer<typeof Clip>;
export type TrackKind = z.infer<typeof TrackKind>;
export type TextStyle = z.infer<typeof TextStyle>;
export type Track = z.infer<typeof Track>;
export type Settings = z.infer<typeof Settings>;
export type CaptionStyle = z.infer<typeof CaptionStyle>;
export type CaptionPosition = z.infer<typeof CaptionPosition>;
export type PresetColumns = z.infer<typeof PresetColumns>;
export type InsetPosition = z.infer<typeof InsetPosition>;
export type ExportPreset = z.infer<typeof ExportPreset>;
export type AssetGroups = z.infer<typeof AssetGroups>;
export type Project = z.infer<typeof Project>;
