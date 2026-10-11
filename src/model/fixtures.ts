import { defaultFields } from "./ops";
import type { Project } from "./schema";

/** Sample project used by tests (video, lighting and BGM tracks with a few clips). */
export function sampleProject(): Project {
  return {
    version: 1,
    settings: { fps: 30, width: 1920, height: 1080 },
    tracks: [
      {
        id: "video",
        name: "Video",
        kind: "visual",
        fields: [
          { key: "ref", label: "Video reference", type: "media" },
          { key: "desc", label: "Description (client)", type: "text" },
          { key: "color", label: "Color notes (CG)", type: "text" },
        ],
        clips: [
          { id: "video-001", start: "00:00:00:00", end: "00:00:04:00", desc: "Opening" },
          { id: "video-002", start: "00:00:04:00", end: "00:00:10:00", desc: "Main part" },
        ],
      },
      {
        id: "light",
        name: "Lighting",
        kind: "visual",
        fields: [
          { key: "ref", label: "Lighting reference", type: "media" },
          { key: "desc", label: "Lighting description", type: "text" },
          { key: "stage", label: "Stage lights", type: "text" },
          { key: "house", label: "House lights", type: "text" },
        ],
        clips: [{ id: "light-001", start: "00:00:00:00", end: "00:00:10:00", desc: "Fade in from blackout" }],
      },
      { id: "bgm", name: "BGM", kind: "audio", fields: defaultFields("audio"), clips: [] },
    ],
    assetGroups: { groups: [], files: {} },
    exportPresets: [
      {
        id: "client",
        name: "Client review",
        video: { bitrate: 8_000_000, bitrateMode: "variable" },
        audio: { enabled: true, bitrate: 192_000 },
        layout: "single",
        screens: ["video"],
        columns: {
          video: { insets: [], captions: ["desc"] },
          light: { insets: [], captions: [] },
        },
        insetStyle: { position: "bottom-right", size: 20 },
        captionStyle: { position: "bottom", size: 4 },
        burnTimecode: true,
        showLabels: true,
      },
      {
        id: "stage",
        name: "Show check (video + lighting)",
        video: { bitrate: 8_000_000, bitrateMode: "variable" },
        audio: { enabled: true, bitrate: 192_000 },
        layout: "grid",
        screens: ["video", "light"],
        columns: {
          video: { insets: [], captions: ["color"] },
          light: { insets: [], captions: ["desc"] },
        },
        insetStyle: { position: "bottom-right", size: 20 },
        captionStyle: { position: "bottom", size: 4 },
        burnTimecode: true,
        showLabels: true,
      },
    ],
  };
}
