/** New / Open / Save to folder / quit commands shared by the toolbar, start screen, shortcuts and window close. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { fileExists, PROJECT_EXT, projectFile } from "../io/backend";
import {
  forgetRecent,
  hasContent,
  newUntitledProject,
  openOrCreateProject,
  releaseCurrentProject,
  saveNow,
  saveProjectTo,
} from "../io/project";
import { useStore } from "../store/store";
import { stop } from "./preview/player";
import { askUnsaved } from "./UnsavedDialog";

const report = (e: unknown) => useStore.setState({ notice: `Failed: ${e instanceof Error ? e.message : e}` });

/** Commits a cell that is still being edited (cells save on blur). */
function commitActiveInput() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

/**
 * Leaves the current project. An untitled project with content triggers Save / Don't Save / Cancel;
 * "Don't Save" (or an empty untitled project) deletes its temporary folder. Returns false when cancelled.
 */
async function leaveProject(): Promise<boolean> {
  stop();
  commitActiveInput();
  let discard = false;
  if (useStore.getState().untitled && hasContent()) {
    const choice = await askUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveToFolder())) return false;
    discard = choice === "discard";
  }
  if (
    !discard &&
    !(await saveNow()) &&
    !(await confirm(`The latest changes could not be saved:\n${useStore.getState().saveError ?? ""}\n\nLeave anyway and lose them?`, {
      title: "Changes not saved",
      kind: "warning",
    }))
  )
    return false;
  await releaseCurrentProject();
  return true;
}

export async function newProject() {
  try {
    if (await leaveProject()) await newUntitledProject();
  } catch (e) {
    report(e);
  }
}

/** Opens a project: `dir` (recent projects) or a .vcb file picked in the dialog (its folder is the project). */
export async function openProject(dir?: string) {
  try {
    let target = dir;
    if (!target) {
      const file = await open({
        title: "Open a project",
        filters: [{ name: "VconBuilder project", extensions: [PROJECT_EXT] }],
      });
      if (typeof file !== "string") return;
      target = file.replace(/[\\/][^\\/]*$/, "");
    }
    if (target === useStore.getState().dir) return;
    // A recent project that was moved or deleted must not be silently recreated as an empty one.
    if (dir && !(await fileExists(await projectFile(dir)))) {
      forgetRecent(dir);
      useStore.setState({ notice: `${dir} has no project file any more (moved or deleted); removed from recent projects` });
      return;
    }
    if (await leaveProject()) await openOrCreateProject(target);
  } catch (e) {
    report(e);
  }
}

/**
 * "Save to folder…" (untitled: gives the project a home) / "Save a copy…" (saved project).
 * Asks for a name and location; a folder with that name is created. Returns true when done.
 */
export async function saveToFolder(): Promise<boolean> {
  try {
    commitActiveInput();
    const untitled = useStore.getState().untitled;
    const target = await save({
      title: untitled ? "Save project to a folder (a folder with this name is created)" : "Save a copy of the project",
      defaultPath: untitled ? "Untitled project" : "Copy of project",
    });
    if (!target) return false;
    if (untitled) stop();
    await saveProjectTo(target.replace(/\.[A-Za-z0-9]{1,5}$/, ""));
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}

/** Intercepts the window close button so unsaved untitled projects get the Save / Don't Save / Cancel prompt. */
export async function installCloseGuard(): Promise<() => void> {
  const win = getCurrentWindow();
  return win.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      if (await leaveProject()) await win.destroy();
    } catch (e) {
      report(e);
    }
  });
}
