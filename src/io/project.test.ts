import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeProject } from "../model/serialize";
import { emptyProject } from "../model/template";
import { useStore } from "../store/store";

const disk = new Map<string, string>();
let failWrites = false;

vi.mock("./backend", () => ({
  isUntitledDir: async () => false,
  projectFile: async (dir: string) => `${dir}/p.vcb`,
  ensureProjectDirs: async () => {},
  fileExists: async (p: string) => disk.has(p),
  readText: async (p: string) => disk.get(p) ?? "",
  writeTextAtomic: async (p: string, text: string) => {
    if (failWrites) throw new Error("locked");
    disk.set(p, text);
  },
  removeFile: async () => {},
  openProjectDir: async () => {},
  listAssets: async () => [],
  onProjectFileChanged: async () => () => {},
  onAssetsChanged: async () => () => {},
  joinPath: (dir: string, rel: string) => `${dir}/${rel}`,
  assetUrl: (dir: string, rel: string) => `asset://${dir}/${rel}`,
  bumpAssetVersion: () => {},
}));

const { openOrCreateProject, saveNow } = await import("./project");

describe("saveNow", () => {
  beforeEach(async () => {
    disk.clear();
    failWrites = false;
    disk.set("C:/p/p.vcb", serializeProject(emptyProject()));
    await openOrCreateProject("C:/p");
  });

  it("never writes a project the file format would reject", async () => {
    const before = disk.get("C:/p/p.vcb");
    useStore.getState().edit((d) => {
      d.settings.width = 1; // below the 16 px minimum: the file could not be opened again
    });
    expect(await saveNow()).toBe(false);
    expect(disk.get("C:/p/p.vcb")).toBe(before);
    expect(useStore.getState().saveError).toMatch(/invalid values/);

    useStore.getState().undo();
    expect(await saveNow()).toBe(true);
    expect(useStore.getState().saveError).toBeNull();
  });

  it("keeps unsaved changes after a failed write and saves them on the next try", async () => {
    vi.useFakeTimers();
    try {
      failWrites = true;
      useStore.getState().edit((d) => {
        d.settings.width = 1280;
      });
      expect(await saveNow()).toBe(false);
      expect(useStore.getState().saveError).toMatch(/Save failed/);

      failWrites = false;
      await vi.advanceTimersByTimeAsync(3500); // automatic retry
      expect(disk.get("C:/p/p.vcb")).toContain('"width": 1280');
      expect(useStore.getState().saveError).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
