import { describe, expect, it } from "vitest";
import { sampleProject as defaultProject } from "./fixtures";
import { mergedToMarkdown, projectToMarkdown, trackToCsv, trackToMarkdown } from "./textExport";

describe("markdown", () => {
  it("writes a track table with escaped cells", () => {
    const p = defaultProject();
    p.tracks[0].clips[0].desc = "a|b\nc";
    const md = trackToMarkdown(p, p.tracks[0]);
    expect(md.split("\n")[0]).toBe("| IN | OUT | Length | Video reference | Description (client) | Color notes (CG) |");
    expect(md).toContain("| 00:00:00:00 | 00:00:04:00 | 4s |  | a\\|b<br>c |  |");
  });

  it("merged table marks continued clips", () => {
    const p = defaultProject();
    const md = mergedToMarkdown(p, ["video", "light"]).split("\n");
    expect(md[2]).toContain("Opening");
    expect(md[2]).toContain("Fade in from blackout");
    expect(md[3]).toContain("Main part");
    expect(md[3]).toContain("〃");
  });

  it("project markdown has a section per track", () => {
    const md = projectToMarkdown(defaultProject(), "Demo");
    expect(md).toContain("# Demo");
    expect(md).toContain("## Lighting (visual)");
    expect(md).toContain("## Combined");
  });
});

describe("csv", () => {
  it("writes IN / OUT / Length and the columns, with a BOM and quoted cells", () => {
    const p = defaultProject();
    p.tracks[0].clips[1].desc = 'Say "hi", then\nleave';
    const csv = trackToCsv(p, p.tracks[0]);
    expect(csv.startsWith("﻿IN,OUT,Length,Video reference,Description (client),Color notes (CG)\r\n")).toBe(true);
    expect(csv).toContain('00:00:04:00,00:00:10:00,00:00:06:00,,"Say ""hi"", then\nleave",');
  });
});
