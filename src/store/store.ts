import { produce } from "immer";
import { create } from "zustand";
import { type ClipRef, findClip, validateProject } from "../model/ops";
import type { ExportPreset, Project } from "../model/schema";

const HISTORY_LIMIT = 200;

/** Right panel: the conte (track tables) or the assets. */
export type RightTab = "conte" | "assets";

type State = {
  dir: string | null;
  /** True while the project lives in the app data folder and has not been saved anywhere yet. */
  untitled: boolean;
  project: Project | null;
  /** Bumped on every local edit; the autosaver watches it. */
  revision: number;
  past: Project[];
  future: Project[];
  /** Project snapshot taken at the start of a drag, so the whole drag is one undo step. */
  txBase: Project | null;

  selection: ClipRef | null;
  playhead: number;
  playing: boolean;
  /** Preset (composition) shown in the preview and used for export. */
  presetId: string | null;
  assets: string[];
  rightTab: RightTab;
  /** Track shown in the Conte tab. */
  conteTrack: string;
  /** Asset groups folded in the Assets tab ("" = Ungrouped). */
  collapsedGroups: string[];
  addTrackOpen: boolean;
  /** Pending "project not saved" dialog (resolve function), or null. */
  unsavedPrompt: ((choice: "save" | "discard" | "cancel") => void) | null;
  pxPerFrame: number;

  warnings: string[];
  /** Error from the last external edit that could not be loaded (the previous state is kept). */
  loadError: string | null;
  /** Why the latest changes are not on disk yet (write failed / invalid values); null when saved. */
  saveError: string | null;
  notice: string | null;
  /** Bumped when asset files change on disk, so views rebuild their asset URLs. */
  assetEpoch: number;
};

type Actions = {
  setProject(dir: string, project: Project, untitled?: boolean): void;
  /** Replaces the project with a version edited outside the app; the previous state stays undoable. */
  replaceFromDisk(project: Project): void;
  edit(fn: (draft: Project) => void): void;
  /**
   * Applies `fn` to the project and to every undo/redo snapshot without adding a history step
   * (for changes that must hold in every state, e.g. a renamed asset file).
   */
  rewriteAll(fn: (draft: Project) => void): void;
  /** During a drag (after begin()), re-applies `fn` to the state from the start of the drag. */
  editFromBase(fn: (draft: Project) => void): void;
  begin(): void;
  commit(): void;
  undo(): void;
  redo(): void;
  select(ref: ClipRef | null): void;
  setPlayhead(frame: number): void;
  set(partial: Partial<State>): void;
};

export const useStore = create<State & Actions>()((set, get) => ({
  dir: null,
  untitled: false,
  project: null,
  revision: 0,
  past: [],
  future: [],
  txBase: null,
  selection: null,
  playhead: 0,
  playing: false,
  presetId: null,
  assets: [],
  rightTab: "conte",
  conteTrack: "",
  collapsedGroups: [],
  addTrackOpen: false,
  unsavedPrompt: null,
  pxPerFrame: 4,
  warnings: [],
  loadError: null,
  saveError: null,
  notice: null,
  assetEpoch: 0,

  setProject(dir, project, untitled = false) {
    set({
      dir,
      untitled,
      project,
      past: [],
      future: [],
      txBase: null,
      selection: null,
      playhead: 0,
      playing: false,
      presetId: project.exportPresets[0]?.id ?? null,
      rightTab: "conte",
      conteTrack: project.tracks[0]?.id ?? "",
      collapsedGroups: [],
      warnings: validateProject(project),
      loadError: null,
      saveError: null,
    });
  },

  replaceFromDisk(project) {
    const { project: cur, past, selection, presetId } = get();
    set({
      project,
      past: cur ? [...past, cur].slice(-HISTORY_LIMIT) : past,
      future: [],
      selection: findClip(project, selection) ? selection : null,
      presetId: project.exportPresets.some((p) => p.id === presetId) ? presetId : (project.exportPresets[0]?.id ?? null),
      warnings: validateProject(project),
      loadError: null,
      notice: "Reloaded external changes (Ctrl+Z to undo)",
    });
  },

  edit(fn) {
    const { project, past, txBase, revision } = get();
    if (!project) return;
    const next = produce(project, fn);
    if (next === project) return;
    set({
      project: next,
      revision: revision + 1,
      past: txBase ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      warnings: validateProject(next),
    });
  },

  rewriteAll(fn) {
    const { project, past, future, txBase, revision } = get();
    if (!project) return;
    const next = produce(project, fn);
    set({
      project: next,
      past: past.map((p) => produce(p, fn)),
      future: future.map((p) => produce(p, fn)),
      txBase: txBase ? produce(txBase, fn) : null,
      revision: next === project ? revision : revision + 1,
    });
  },

  editFromBase(fn) {
    const { txBase, revision } = get();
    if (!txBase) return get().edit(fn);
    const next = produce(txBase, fn);
    set({ project: next, revision: revision + 1, future: [], warnings: validateProject(next) });
  },

  begin() {
    set({ txBase: get().project });
  },

  commit() {
    const { txBase, project, past } = get();
    if (txBase && txBase !== project) set({ past: [...past, txBase].slice(-HISTORY_LIMIT) });
    set({ txBase: null });
  },

  undo() {
    const { past, future, project, revision } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], revision: revision + 1, warnings: validateProject(prev) });
  },

  redo() {
    const { past, future, project, revision } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), revision: revision + 1, warnings: validateProject(next) });
  },

  select(ref) {
    if (!ref) return set({ selection: null });
    // The Conte tab follows the selected clip's track.
    set({ selection: ref, conteTrack: ref.trackId });
  },

  setPlayhead(frame) {
    set({ playhead: Math.max(0, Math.round(frame)) });
  },

  set(partial) {
    set(partial);
  },
}));

export const fpsOf = () => useStore.getState().project?.settings.fps ?? 30;

/** The preset (composition) currently shown in the preview. */
export function currentPreset(s: { project: Project | null; presetId: string | null }): ExportPreset | undefined {
  return s.project?.exportPresets.find((p) => p.id === s.presetId) ?? s.project?.exportPresets[0];
}
