import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { addGroup, assignAssets, deleteGroup, filesInGroup, groupOf, moveGroup, renameAssetInGroups, renameGroup } from "./assetGroups";
import { parseProject, serializeProject } from "./serialize";
import { emptyProject } from "./template";

const assets = ["assets/a.png", "assets/b.png", "assets/c.wav"];

function sample() {
  return produce(emptyProject(), (d) => {
    addGroup(d, "Storyboard");
    addGroup(d, "Audio");
    assignAssets(d, ["assets/a.png", "assets/b.png"], "Storyboard");
    assignAssets(d, ["assets/c.wav"], "Audio");
  });
}

describe("asset groups", () => {
  it("groups files and keeps the rest ungrouped", () => {
    const p = produce(sample(), (d) => assignAssets(d, ["assets/b.png"], ""));
    expect(filesInGroup(p, "Storyboard", assets)).toEqual(["assets/a.png"]);
    expect(filesInGroup(p, "", assets)).toEqual(["assets/b.png"]);
  });

  it("makes names unique, renames, reorders and deletes", () => {
    let p = produce(sample(), (d) => void addGroup(d, "Storyboard"));
    expect(p.assetGroups.groups).toEqual(["Storyboard", "Audio", "Storyboard 2"]);
    p = produce(p, (d) => void renameGroup(d, "Storyboard", "Conte"));
    expect(groupOf(p, "assets/a.png")).toBe("Conte");
    p = produce(p, (d) => moveGroup(d, "Storyboard 2", -2));
    expect(p.assetGroups.groups).toEqual(["Storyboard 2", "Conte", "Audio"]);
    p = produce(p, (d) => deleteGroup(d, "Conte"));
    expect(groupOf(p, "assets/a.png")).toBe("");
    expect(p.assetGroups.groups).toEqual(["Storyboard 2", "Audio"]);
  });

  it("follows renamed files and survives a save/load round trip", () => {
    const p = produce(sample(), (d) => renameAssetInGroups(d, "assets/a.png", "assets/hero.png"));
    expect(groupOf(p, "assets/hero.png")).toBe("Storyboard");
    const r = parseProject(serializeProject(p));
    expect(r.ok && r.project.assetGroups).toEqual(p.assetGroups);
  });

  it("turns the short-lived folder format into groups", () => {
    const r = parseProject(
      JSON.stringify({ assetFolders: { folders: ["Storyboard", "Storyboard/Shots"], files: { "assets/a.png": "Storyboard/Shots" } } }),
    );
    expect(r.ok && r.project.assetGroups).toEqual({
      groups: ["Storyboard", "Storyboard / Shots"],
      files: { "assets/a.png": "Storyboard / Shots" },
    });
  });
});
