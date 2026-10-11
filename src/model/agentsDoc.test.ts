import { describe, expect, it } from "vitest";
import { isGeneratedClaudeMd, mergeAgentsMd } from "./agentsDoc";
import { validateProject } from "./ops";
import { parseProject } from "./serialize";

describe("AGENTS.md", () => {
  it("creates the guide with a notes section, and refreshes only the generated block", () => {
    const fresh = mergeAgentsMd(null);
    expect(fresh).toContain("# VconBuilder project – guide for AI agents");
    expect(fresh).toContain("## Project notes");
    expect(fresh).not.toContain("\\`"); // no stray escapes in the rendered Markdown

    const edited = fresh
      .replace("## Project notes", "## Project notes\n\nLighting cues follow the DMX sheet.")
      .replace("guide for AI agents", "OLD TITLE");
    const merged = mergeAgentsMd(edited);
    expect(merged).toContain("Lighting cues follow the DMX sheet.");
    expect(merged).toContain("guide for AI agents");
    expect(merged).not.toContain("OLD TITLE");
    expect(mergeAgentsMd(merged)).toBe(merged);
  });

  it("appends the guide to an AGENTS.md without markers", () => {
    const merged = mergeAgentsMd("# My notes\n");
    expect(merged.startsWith("# My notes")).toBe(true);
    expect(merged).toContain("vconbuilder:begin");
  });

  it("documents an example that really loads without warnings", () => {
    const json = /```json\n([\s\S]*?)```/.exec(mergeAgentsMd(null))![1];
    const r = parseProject(json);
    if (!r.ok) throw new Error(r.error);
    expect(validateProject(r.project)).toEqual([]);
    expect(r.project.exportPresets.map((p) => p.columns.storyboard.captions)).toEqual([["note"], ["cg"]]);
    expect(r.project.tracks[0].clips).toHaveLength(2);
  });

  it("recognises only the CLAUDE.md files earlier versions generated", () => {
    expect(isGeneratedClaudeMd("@AGENTS.md\n")).toBe(true);
    expect(isGeneratedClaudeMd("# VconBuilder project\n\nThis folder…")).toBe(true);
    expect(isGeneratedClaudeMd("# my own claude notes\n@AGENTS.md")).toBe(false);
  });
});
