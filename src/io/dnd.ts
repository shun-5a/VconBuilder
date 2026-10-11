import { useStore } from "../store/store";
import { downloadAsset, importFile } from "./backend";
import { refreshAssets } from "./project";

/** MIME type for dragging an asset from the asset panel inside the app. */
export const ASSET_MIME = "application/x-vcon-asset";

export type DropSnapshot = { asset?: string; files: File[]; url?: string };

export function isAcceptableDrag(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(ASSET_MIME) || types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
}

/** DataTransfer is only readable during the event, so copy what we need synchronously. */
export function snapshotDrop(dt: DataTransfer): DropSnapshot {
  const asset = dt.getData(ASSET_MIME) || undefined;
  const files = Array.from(dt.files);
  let url: string | undefined;
  const html = dt.getData("text/html");
  const img = /<img[^>]+src="([^"]+)"/i.exec(html);
  if (img) url = img[1].replace(/&amp;/g, "&");
  if (!url) {
    url = dt
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((l) => l && !l.startsWith("#"));
  }
  if (!url) {
    const text = dt.getData("text/plain").trim();
    if (/^(https?:|data:)/.test(text)) url = text;
  }
  return { asset, files, url };
}

/** Imports dropped files / browser images into assets/ and returns their project-relative paths. */
export async function importDrop(snap: DropSnapshot): Promise<string[]> {
  if (snap.asset) return [snap.asset];
  const dir = useStore.getState().dir;
  if (!dir) return [];
  try {
    let paths: string[] = [];
    if (snap.files.length) {
      paths = [];
      for (const f of snap.files) paths.push(await importFile(dir, f));
    } else if (snap.url?.startsWith("data:")) {
      const blob = await (await fetch(snap.url)).blob();
      const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*/, "") || "bin";
      paths = [await importFile(dir, new File([blob], `image.${ext}`, { type: blob.type }))];
    } else if (snap.url && /^https?:/.test(snap.url)) {
      paths = [await downloadAsset(dir, snap.url)];
    }
    if (paths.length) await refreshAssets();
    return paths;
  } catch (e) {
    useStore.setState({ notice: `Import failed: ${e}` });
    return [];
  }
}
