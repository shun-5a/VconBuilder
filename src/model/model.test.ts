import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { sampleProject as defaultProject } from "./fixtures";
import { buildMergedRows } from "./merged";
import { addClip, addField, changeFps, insertClipAfter, moveClip, removeClip, splitClip, trimClip, validateProject } from "./ops";
import type { Project } from "./schema";
import { parseProject, serializeProject } from "./serialize";
import { framesToTc, parseTcInput, tcToFrames } from "./timecode";

const ranges = (p: Project, trackId: string) => p.tracks.find((t) => t.id === trackId)!.clips.map((c) => `${c.id}:${c.start}-${c.end}`);

function sample(): Project {
  const p = defaultProject();
  p.tracks[0].clips = [
    { id: "a", start: "00:00:00:00", end: "00:00:02:00" },
    { id: "b", start: "00:00:02:00", end: "00:00:05:00" },
    { id: "c", start: "00:00:08:00", end: "00:00:10:00" },
  ];
  return p;
}

describe("timecode", () => {
  it("round-trips", () => {
    expect(tcToFrames("01:02:03:04", 30)).toBe(((1 * 60 + 2) * 60 + 3) * 30 + 4);
    expect(framesToTc(tcToFrames("01:02:03:04", 24), 24)).toBe("01:02:03:04");
  });
  it("parses lenient input", () => {
    expect(parseTcInput("3:04", 30)).toBe(3 * 30 + 4);
    expect(parseTcInput("10203", 30)).toBe((1 * 60 + 2) * 30 + 3);
    expect(parseTcInput("2.5s", 30)).toBe(75);
    expect(parseTcInput("+10", 30, 100)).toBe(110);
    expect(parseTcInput("-1s", 30, 100)).toBe(70);
    expect(parseTcInput("abc", 30)).toBeNull();
  });
});

describe("ops", () => {
  it("addClip fits into gap and refuses occupied frames", () => {
    let id: string | null = null;
    const p = produce(sample(), (d) => {
      id = addClip(d, "video", 6 * 30, 10 * 30);
    });
    expect(id).not.toBeNull();
    expect(ranges(p, "video")[2]).toMatch(/00:00:06:00-00:00:08:00/);
    produce(sample(), (d) => {
      expect(addClip(d, "video", 30, 30)).toBeNull();
    });
  });

  it("insertClipAfter ripples following clips", () => {
    const p = produce(sample(), (d) => {
      insertClipAfter(d, { trackId: "video", clipId: "a" }, 30);
    });
    expect(ranges(p, "video")).toEqual([
      "a:00:00:00:00-00:00:02:00",
      "video-004:00:00:02:00-00:00:03:00",
      "b:00:00:03:00-00:00:06:00",
      "c:00:00:09:00-00:00:11:00",
    ]);
  });

  it("removeClip with ripple closes the gap", () => {
    const p = produce(sample(), (d) => removeClip(d, { trackId: "video", clipId: "b" }, true));
    expect(ranges(p, "video")).toEqual(["a:00:00:00:00-00:00:02:00", "c:00:00:05:00-00:00:07:00"]);
  });

  it("moveClip snaps into the nearest free slot", () => {
    const p = produce(sample(), (d) => moveClip(d, { trackId: "video", clipId: "a" }, 4 * 30));
    expect(ranges(p, "video")).toContain("a:00:00:05:00-00:00:07:00");
  });

  it("ripple move shifts later clips too", () => {
    const p = produce(sample(), (d) => moveClip(d, { trackId: "video", clipId: "b" }, 3 * 30, true));
    expect(ranges(p, "video")).toEqual(["a:00:00:00:00-00:00:02:00", "b:00:00:03:00-00:00:06:00", "c:00:00:09:00-00:00:11:00"]);
  });

  it("trim end is limited by the next clip unless ripple", () => {
    const ref = { trackId: "video", clipId: "a" };
    const p1 = produce(sample(), (d) => trimClip(d, ref, "end", 3 * 30));
    expect(ranges(p1, "video")[0]).toBe("a:00:00:00:00-00:00:02:00");
    const p2 = produce(sample(), (d) => trimClip(d, ref, "end", 3 * 30, true));
    expect(ranges(p2, "video")).toEqual(["a:00:00:00:00-00:00:03:00", "b:00:00:03:00-00:00:06:00", "c:00:00:09:00-00:00:11:00"]);
  });

  it("trim start of audio moves offset", () => {
    const p0 = sample();
    p0.tracks[2].clips = [{ id: "m", start: "00:00:01:00", end: "00:00:10:00", ref: "assets/bgm.wav" }];
    const p = produce(p0, (d) => trimClip(d, { trackId: "bgm", clipId: "m" }, "start", 2 * 30));
    expect(p.tracks[2].clips[0]).toMatchObject({ start: "00:00:02:00", offset: "00:00:01:00" });
    // cannot extend before the start of the media
    const p2 = produce(p, (d) => trimClip(d, { trackId: "bgm", clipId: "m" }, "start", 0));
    expect(p2.tracks[2].clips[0]).toMatchObject({ start: "00:00:01:00", offset: "00:00:00:00" });
  });

  it("splitClip creates a right half", () => {
    const p = produce(sample(), (d) => {
      splitClip(d, { trackId: "video", clipId: "b" }, 3 * 30);
    });
    expect(ranges(p, "video")).toEqual([
      "a:00:00:00:00-00:00:02:00",
      "b:00:00:02:00-00:00:03:00",
      "video-004:00:00:03:00-00:00:05:00",
      "c:00:00:08:00-00:00:10:00",
    ]);
  });

  it("changeFps keeps seconds", () => {
    const p = produce(sample(), (d) => changeFps(d, 24));
    expect(ranges(p, "video")[1]).toBe("b:00:00:02:00-00:00:05:00");
  });

  it("changeFps never creates empty or overlapping clips", () => {
    const p = produce(sample(), (d) => {
      d.settings.fps = 60;
      d.tracks[0].clips = ["00:00:00:00", "00:00:00:01", "00:00:00:02", "00:00:00:03"].map((start, i) => ({
        id: `c${i}`,
        start,
        end: `00:00:00:0${i + 1}`,
      }));
      changeFps(d, 24);
    });
    expect(validateProject(p)).toEqual([]);
    expect(p.tracks[0].clips.map((c) => `${c.start}-${c.end}`)).toEqual([
      "00:00:00:00-00:00:00:01",
      "00:00:00:01-00:00:00:02",
      "00:00:00:02-00:00:00:03",
      "00:00:00:03-00:00:00:04",
    ]);
  });

  it("swaps a row with its neighbour and keeps both lengths and the span", async () => {
    const { swapClip } = await import("./ops");
    const p = produce(sample(), (d) => {
      d.tracks[0].clips = [
        { id: "a", start: "00:01:00:00", end: "00:02:00:00", desc: "A" },
        { id: "b", start: "00:02:00:00", end: "00:04:00:00", desc: "B" },
        { id: "c", start: "00:05:00:00", end: "00:06:00:00", desc: "C" },
      ];
      swapClip(d, { trackId: d.tracks[0].id, clipId: "a" }, 1);
    });
    const rows = () => p.tracks[0].clips.map((c) => `${c.desc}:${c.start}-${c.end}`);
    expect(rows()).toEqual(["B:00:01:00:00-00:03:00:00", "A:00:03:00:00-00:04:00:00", "C:00:05:00:00-00:06:00:00"]);
    // The gap before the next row is kept when swapping across it.
    const q = produce(p, (d) => swapClip(d, { trackId: d.tracks[0].id, clipId: "c" }, -1));
    expect(q.tracks[0].clips.map((c) => `${c.desc}:${c.start}-${c.end}`)).toEqual([
      "B:00:01:00:00-00:03:00:00",
      "C:00:03:00:00-00:04:00:00",
      "A:00:05:00:00-00:06:00:00",
    ]);
  });

  it("slips the source of a clip without moving it, within the source", async () => {
    const { slipClip } = await import("./ops");
    const base = produce(sample(), (d) => {
      d.tracks[0].clips = [{ id: "v", start: "00:00:02:00", end: "00:00:04:00", ref: "assets/a.mp4", offset: "00:00:01:00" }];
    });
    const ref = { trackId: base.tracks[0].id, clipId: "v" };
    const at = (offset: number, max?: number) => produce(base, (d) => slipClip(d, ref, offset, max)).tracks[0].clips[0];
    expect(at(45)).toMatchObject({ start: "00:00:02:00", end: "00:00:04:00", offset: "00:00:01:15" });
    expect(at(-10).offset).toBeUndefined(); // never before the start of the source
    expect(at(500, 90).offset).toBe("00:00:03:00"); // a 5 s source: a 2 s clip can start at 3 s at most
  });

  it("duplicates a clip next to the original", async () => {
    const { duplicateClip, moveClip } = await import("./ops");
    const p = produce(sample(), (d) => {
      d.tracks[0].clips = [{ id: "a", start: "00:00:00:00", end: "00:00:02:00", desc: "A" }];
      const id = duplicateClip(d, { trackId: d.tracks[0].id, clipId: "a" });
      moveClip(d, { trackId: d.tracks[0].id, clipId: id }, 30); // dropped on the original: lands right after it
    });
    expect(p.tracks[0].clips.map((c) => `${c.desc}:${c.start}-${c.end}`)).toEqual([
      "A:00:00:00:00-00:00:02:00",
      "A:00:00:02:00-00:00:04:00",
    ]);
    expect(new Set(p.tracks[0].clips.map((c) => c.id)).size).toBe(2);
  });

  it("rejects reserved or duplicate column keys", async () => {
    const { parseProject } = await import("./serialize");
    const track = (fields: object[]) => JSON.stringify({ tracks: [{ id: "v", name: "V", kind: "visual", fields }] });
    expect(parseProject(track([{ key: "id", label: "ID" }])).ok).toBe(false);
    expect(
      parseProject(
        track([
          { key: "a", label: "A" },
          { key: "a", label: "B" },
        ]),
      ).ok,
    ).toBe(false);
    expect(parseProject(track([{ key: "a", label: "A" }])).ok).toBe(true);
  });

  it("validateProject reports overlaps", () => {
    const p = sample();
    p.tracks[0].clips[1].start = "00:00:01:00";
    expect(validateProject(p).some((m) => m.includes("overlap"))).toBe(true);
  });
});

describe("merged rows", () => {
  it("spans clips across cut points of other tracks", () => {
    const p = sample();
    p.tracks[1].clips = [
      { id: "l1", start: "00:00:00:00", end: "00:00:01:00" },
      { id: "l2", start: "00:00:01:00", end: "00:00:09:00" },
    ];
    const rows = buildMergedRows(p, ["video", "light"]);
    expect(rows.map((r) => r.start / 30)).toEqual([0, 1, 2, 5, 8, 9]);
    expect(rows[0].cells.video).toMatchObject({ kind: "clip", span: 2 });
    expect(rows[1].cells.video).toEqual({ kind: "covered" });
    expect(rows[3].cells.video).toMatchObject({ kind: "gap", span: 1 });
    expect(rows[1].cells.light).toMatchObject({ kind: "clip", span: 4 });
    expect(rows[5].cells.light).toMatchObject({ kind: "gap", span: 1 });
  });
});

describe("serialize", () => {
  it("round-trips and writes one clip per line", () => {
    const p = defaultProject();
    const text = serializeProject(p);
    expect(text).toContain('\n        {"start":"00:00:00:00","end":"00:00:04:00"');
    const r = parseProject(text);
    expect(r.ok && r.project).toEqual(p);
  });
  it("orders clip keys as timing, then columns", () => {
    const p = defaultProject();
    p.tracks[0].clips = [{ id: "x", desc: "d", end: "00:00:01:00", ref: "assets/a.png", start: "00:00:00:00" }];
    expect(serializeProject(p)).toContain(`{"start":"00:00:00:00","end":"00:00:01:00","ref":"assets/a.png","desc":"d"}`);
  });
  it("reports schema errors", () => {
    const r = parseProject('{"tracks":[{"id":"x","name":"x","kind":"bogus"}]}');
    expect(r.ok).toBe(false);
  });
});

describe("track kinds & new projects", () => {
  it("reads the former cue kind as a visual track", async () => {
    const { parseProject } = await import("./serialize");
    const r = parseProject('{"tracks":[{"id":"light","name":"Lighting","kind":"cue"}]}');
    expect(r.ok && r.project.tracks[0].kind).toBe("visual");
  });

  it("gives audio tracks only text columns and renames the old Source column", async () => {
    const { parseProject } = await import("./serialize");
    const r = parseProject(
      '{"tracks":[{"id":"bgm","name":"BGM","kind":"audio","fields":[{"key":"ref","label":"Source","type":"media"}]}]}',
    );
    if (!r.ok) throw new Error("parse failed");
    expect(r.project.tracks[0].fields[0].label).toBe("Reference");
    const key = addField(r.project, "bgm", "media");
    expect(r.project.tracks[0].fields.find((f) => f.key === key)?.type).toBe("text");
  });

  it("keeps a media column first on every track (Reference)", async () => {
    const { parseProject } = await import("./serialize");
    const { moveField, removeField } = await import("./ops");
    const r = parseProject(
      JSON.stringify({
        tracks: [
          { id: "a", name: "A", kind: "visual", fields: [{ key: "note", label: "Notes" }] },
          {
            id: "b",
            name: "B",
            kind: "visual",
            fields: [
              { key: "note", label: "Notes" },
              { key: "img", label: "Img", type: "media" },
            ],
          },
        ],
      }),
    );
    if (!r.ok) throw new Error(r.error);
    const [a, b] = r.project.tracks;
    expect(a.fields.map((f) => f.key)).toEqual(["ref", "note"]);
    expect(b.fields.map((f) => f.key)).toEqual(["img", "note"]);
    const p = produce(r.project, (d) => {
      removeField(d, "a", "ref");
      moveField(d, "a", "ref", 1);
      moveField(d, "a", "note", -1);
    });
    expect(p.tracks[0].fields.map((f) => f.key)).toEqual(["ref", "note"]);
  });

  it("drops the removed solo flag and clip gain / fades", async () => {
    const { parseProject } = await import("./serialize");
    const r = parseProject(
      '{"tracks":[{"id":"bgm","name":"BGM","kind":"audio","solo":true,"clips":[{"start":"00:00:00:00","end":"00:00:01:00","gain":-3,"fadeIn":5,"fadeOut":5}]}]}',
    );
    expect(r.ok).toBe(true);
    const t = r.ok ? r.project.tracks[0] : undefined;
    expect(t && "solo" in t).toBe(false);
    expect(Object.keys(t!.clips[0]).sort()).toEqual(["end", "id", "start"]);
  });

  it("starts empty with one generic preset and generic default columns", async () => {
    const { emptyProject } = await import("./template");
    const { addTrack } = await import("./ops");
    const p = produce(emptyProject(), (d) => {
      addTrack(d, "visual");
      addTrack(d, "visual", "  ");
      addTrack(d, "audio", "Music");
      addTrack(d, "visual", "照明");
      addTrack(d, "visual", "Main Video!");
    });
    expect(emptyProject().tracks).toEqual([]);
    expect(p.tracks.slice(3).map((t) => [t.id, t.name])).toEqual([
      ["visual3", "照明"],
      ["main-video", "Main Video!"],
    ]);
    expect(p.tracks.slice(0, 3).map((t) => [t.id, t.name])).toEqual([
      ["visual", "Visual 1"],
      ["visual2", "Visual 2"],
      ["music", "Music"],
    ]);
    expect(p.tracks[0].fields.map((f) => f.label)).toEqual(["Reference", "Notes"]);
    expect(p.tracks[2].fields.map((f) => f.label)).toEqual(["Reference", "Notes"]);
  });
});

describe("preview settings", () => {
  it("shows every visual track until toggled, and an empty list means none", async () => {
    const { resolvePreset } = await import("../render/compositor");
    const { emptyProject } = await import("./template");
    const { addTrack } = await import("./ops");
    const { toggleScreen, presetIdFor, addDefaultPreset } = await import("./preview");
    const p = produce(emptyProject(), (d) => {
      addTrack(d, "visual", "A");
      addTrack(d, "audio", "Music");
      addTrack(d, "visual", "B");
    });
    // new projects come with one preset, "Main", that shows every visual track
    expect(p.exportPresets.map((x) => [x.id, x.name])).toEqual([["main", "Main"]]);
    const show = (fn: (pre: (typeof p.exportPresets)[0]) => void) => produce(p.exportPresets[0], fn);
    expect(resolvePreset(p, p.exportPresets[0])).toMatchObject({ screens: ["a", "b"], layout: "grid", width: 1920 });
    const onlyB = show((pre) => toggleScreen(p, pre, "a"));
    expect(resolvePreset(p, onlyB)).toMatchObject({ screens: ["b"], layout: "single" });
    const none = produce(onlyB, (pre) => toggleScreen(p, pre, "b"));
    expect(resolvePreset(p, none).screens).toEqual([]);
    const both = produce(none, (pre) => {
      toggleScreen(p, pre, "b");
      toggleScreen(p, pre, "a");
    });
    expect(both.screens).toEqual(["a", "b"]); // timeline order, not click order
    expect(presetIdFor(p, "Client review")).toBe("client-review");
    const two = produce(p, (d) => void addDefaultPreset(d));
    expect(two.exportPresets.map((x) => x.name)).toEqual(["Main", "Preset 2"]);
  });

  it("always keeps at least one preset when loading", async () => {
    const { parseProject } = await import("./serialize");
    const r = parseProject("{}");
    expect(r.ok && r.project.exportPresets.map((x) => x.name)).toEqual(["Main"]);
  });

  it("reads a missing screens list as every visual track, and keeps an empty one empty", async () => {
    const { parseProject } = await import("./serialize");
    const tracks = [
      { id: "v", name: "V", kind: "visual" },
      { id: "a", name: "A", kind: "audio" },
    ];
    const r = parseProject(
      JSON.stringify({
        tracks,
        exportPresets: [
          { id: "p", name: "P" },
          { id: "q", name: "Q", screens: [] },
        ],
      }),
    );
    expect(r.ok && r.project.exportPresets.map((x) => x.screens)).toEqual([["v"], []]);
  });
});

describe("preset columns (picture / captions per preset)", () => {
  it("migrates old preset caption lists and column flags into every preset's columns", async () => {
    const { parseProject } = await import("./serialize");
    const r = parseProject(
      JSON.stringify({
        tracks: [
          {
            id: "v",
            name: "V",
            kind: "visual",
            fields: [
              { key: "ref", label: "Ref", type: "media" },
              { key: "alt", label: "Alt", type: "media", show: true },
              { key: "desc", label: "Desc" },
              { key: "cg", label: "CG", show: true },
            ],
          },
          { id: "a", name: "A", kind: "audio", fields: [{ key: "src", label: "Src", type: "media" }] },
        ],
        exportPresets: [
          { id: "p", name: "P", captions: [{ track: "v", field: "desc", position: "top", size: 6 }] },
          { id: "q", name: "Q", screens: ["v"] },
        ],
      }),
    );
    if (!r.ok) throw new Error(r.error);
    const [p, q] = r.project.exportPresets;
    // the old picture choice (not the first media column) becomes an inset
    expect(p.columns).toEqual({ v: { insets: ["alt"], captions: ["desc", "cg"] } });
    expect(q.columns).toEqual({ v: { insets: ["alt"], captions: ["cg"] } });
    expect(p.screens).toEqual(["v"]); // a missing list meant "every visual track"
    expect(p.captionStyle).toEqual({ position: "top", size: 6 });
    expect(r.project.tracks[0].fields.some((f) => "show" in f)).toBe(false);
  });

  it("lets presets show different insets / captions from the same table", async () => {
    const { addField } = await import("./ops");
    const { toggleInset, toggleCaption, insetKeys, captionKeys } = await import("./preview");
    const { clipMediaRef, clipVisualRefs } = await import("../render/compositor");
    let p = produce(defaultProject(), (d) => void addField(d, "video", "media", "Alt"));
    const t = () => p.tracks[0];
    const [client, stage] = p.exportPresets;
    expect(captionKeys(client, t())).toEqual(["desc"]);
    expect(captionKeys(stage, t())).toEqual(["color"]);

    p = produce(p, (d) => {
      toggleInset(d.exportPresets[0], d.tracks[0], "media"); // client: + inset
      toggleCaption(d.exportPresets[0], d.tracks[0], "color"); // client: + color
      toggleInset(d.exportPresets[1], d.tracks[0], "ref"); // the Reference column cannot be an inset
    });
    const clip = { id: "x", start: "00:00:00:00", end: "00:00:01:00", ref: "assets/a.png", media: "assets/b.png" };
    expect(clipMediaRef(t(), clip)).toBe("assets/a.png"); // always the picture
    expect(clipVisualRefs(t(), clip, p.exportPresets[0])).toEqual(["assets/a.png", "assets/b.png"]);
    expect(captionKeys(p.exportPresets[0], t())).toEqual(["desc", "color"]);
    expect(insetKeys(p.exportPresets[1], t())).toEqual([]);
    expect(clipVisualRefs(t(), clip, p.exportPresets[1])).toEqual(["assets/a.png"]);

    // insets survive a save/load round trip
    const { parseProject, serializeProject } = await import("./serialize");
    const again = parseProject(serializeProject(p));
    expect(again.ok && insetKeys(again.project.exportPresets[0], again.project.tracks[0])).toEqual(["media"]);
  });

  it("keeps presets in step with tracks and fields", async () => {
    const { addTrack, removeField, removeTrack } = await import("./ops");
    let p = produce(defaultProject(), (d) => void addTrack(d, "visual", "FX"));
    for (const preset of p.exportPresets) {
      expect(preset.screens).toContain("fx");
      expect(preset.columns.fx).toEqual({ insets: [], captions: [] });
    }
    p = produce(p, (d) => {
      removeField(d, "video", "desc");
      removeTrack(d, "light");
    });
    expect(p.exportPresets[0].columns.video.captions).toEqual([]);
    expect(p.exportPresets[1].screens).toEqual(["video", "fx"]);
    expect("light" in p.exportPresets[1].columns).toBe(false);
  });

  it("does not write clip ids; rows get positional ids on load", async () => {
    const { parseProject, serializeProject } = await import("./serialize");
    const text = serializeProject(defaultProject());
    expect(text).not.toContain('"id":"video-001"');
    expect(text).toContain('{"start":"00:00:00:00","end":"00:00:04:00","desc":"Opening"}');
    expect(text).toContain('"video": {"insets":[],"captions":["desc"]}');
    const r = parseProject(text);
    expect(r.ok && r.project.tracks[0].clips.map((c) => c.id)).toEqual(["video-001", "video-002"]);
  });
});

describe("old automatic Default preset", () => {
  it("is dropped when untouched and kept when customised", async () => {
    const { parseProject } = await import("./serialize");
    const auto = { id: "default", name: "Default", layout: "grid", screens: [], captionStyle: { position: "bottom", size: 4 } };
    const r1 = parseProject(JSON.stringify({ exportPresets: [auto, { id: "mine", name: "Mine" }] }));
    expect(r1.ok && r1.project.exportPresets.map((p) => p.id)).toEqual(["mine"]);
    const r2 = parseProject(JSON.stringify({ exportPresets: [{ ...auto, width: 3840, height: 720 }] }));
    expect(r2.ok && r2.project.exportPresets.map((p) => p.id)).toEqual(["default"]);
  });
});

describe("renaming assets", () => {
  it("points every media value at the new path and leaves text alone", async () => {
    const { renameMediaRefs } = await import("./ops");
    const p0 = defaultProject();
    p0.tracks[0].clips[0].ref = "assets/a.png";
    p0.tracks[0].clips[1].ref = "assets/a.png";
    p0.tracks[0].clips[1].desc = "assets/a.png"; // a text column that happens to contain the path
    p0.tracks[1].clips[0].ref = "assets/b.png";
    const p = produce(p0, (d) => renameMediaRefs(d, "assets/a.png", "assets/hero.png"));
    expect(p.tracks[0].clips.map((c) => c.ref)).toEqual(["assets/hero.png", "assets/hero.png"]);
    expect(p.tracks[0].clips[1].desc).toBe("assets/a.png");
    expect(p.tracks[1].clips[0].ref).toBe("assets/b.png");
  });
});
