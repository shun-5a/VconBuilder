import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Extension of the project file: `<folder name>.vcb` (JSON), opened by double-click once installed. */
export const PROJECT_EXT = "vcb";

export const joinPath = (dir: string, rel: string) => `${dir.replace(/[\\/]+$/, "")}/${rel}`;

export const readText = (path: string) => invoke<string>("read_text", { path });
export const fileExists = (path: string) => invoke<boolean>("file_exists", { path });
export const writeTextAtomic = (path: string, text: string) => invoke<void>("write_text_atomic", { path, text });
export const ensureProjectDirs = (dir: string) => invoke<void>("ensure_project_dirs", { dir });
export const openProjectDir = (dir: string) => invoke<void>("open_project", { dir });
/** Path of the folder's project file (`<folder name>.vcb`, or the only .vcb in it). */
export const projectFile = (dir: string) => invoke<string>("project_file", { dir });
/** Folder this window was launched to open (a double-clicked .vcb), if any. */
export const takeOpenDir = () => invoke<string | null>("take_open_dir");
export const listAssets = (dir: string) => invoke<string[]>("list_assets", { dir });
export const reserveAsset = (dir: string, name: string) => invoke<string>("reserve_asset", { dir, name });
export const renameAssetFile = (dir: string, rel: string, newName: string) => invoke<string>("rename_asset", { dir, rel, newName });
export const downloadAsset = (dir: string, url: string) => invoke<string>("download_asset", { dir, url });
export const createEmptyFile = (path: string) => invoke<void>("create_empty_file", { path });
export const removeFile = (path: string) => invoke<void>("remove_file", { path });
export const revealPath = (path: string) => invoke<void>("reveal_path", { path });

/** Writes raw bytes at `position` in the file at absolute `path`. */
export function writeChunk(path: string, position: number, data: Uint8Array) {
  return invoke<void>("write_chunk", data, {
    headers: { "x-path": encodeURIComponent(path), "x-position": String(position) },
  });
}

const CHUNK = 8 * 1024 * 1024;

/** Copies a dropped File into `assets/` in chunks; returns its project-relative path. */
export async function importFile(dir: string, file: File): Promise<string> {
  const rel = await reserveAsset(dir, file.name || "asset");
  const abs = joinPath(dir, rel);
  for (let pos = 0; pos < file.size; pos += CHUNK) {
    const buf = new Uint8Array(await file.slice(pos, pos + CHUNK).arrayBuffer());
    await writeChunk(abs, pos, buf);
  }
  return rel;
}

/** URL the webview can load for a project-relative asset path. */
export function assetUrl(dir: string, rel: string): string {
  return convertFileSrc(joinPath(dir, rel));
}

// Change events are sent only to the window that has the folder open.
export function onProjectFileChanged(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen("fs-project-changed", cb);
}

export function onAssetsChanged(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen("fs-assets-changed", cb);
}

// Untitled projects live in the app data folder until "Save to folder…".
export const listUntitled = () => invoke<string[]>("list_untitled");
export const createUntitledDir = () => invoke<string>("create_untitled_dir");
export const isUntitledDir = (dir: string) => invoke<boolean>("is_untitled_dir", { dir });
export const discardUntitled = (dir: string) => invoke<void>("discard_untitled", { dir });
export const stopWatchingDir = () => invoke<void>("stop_watching");
export const copyProject = (from: string, to: string) => invoke<void>("copy_project", { from, to });
