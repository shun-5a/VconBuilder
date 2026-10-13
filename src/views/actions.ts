/** Editing commands shared by the table, timeline and keyboard shortcuts. */

import { assetUrl, renameAssetFile } from "../io/backend";
import { refreshAssets } from "../io/project";
import { renameAssetInGroups } from "../model/assetGroups";
import { addClip, clipAt, endF, getClip, removeClip, renameMediaRefs, splitClip, trimClip } from "../model/ops";
import type { Track, TrackKind } from "../model/schema";
import { mediaDuration, mediaKind } from "../render/media";
import { useStore } from "../store/store";

export const DEFAULT_STILL_SECONDS = 3;

export function acceptsMedia(kind: TrackKind, rel: string): boolean {
  const m = mediaKind(rel);
  if (kind === "text") return false;
  return kind === "audio" ? m === "audio" : m === "image" || m === "video";
}

/** Duration in frames a new clip for this asset should get. */
export async function assetDurationFrames(rel: string, fps: number): Promise<number> {
  const kind = mediaKind(rel);
  const dir = useStore.getState().dir;
  if (dir && (kind === "video" || kind === "audio")) {
    const sec = await mediaDuration(assetUrl(dir, rel), kind);
    if (sec > 0) return Math.max(1, Math.round(sec * fps));
  }
  return DEFAULT_STILL_SECONDS * fps;
}

const mediaFieldKey = (t: Track) => t.fields.find((f) => f.type === "media")?.key;

/** Creates a clip for an asset dropped at `frame` on a track; returns the new clip end frame, or null. */
export async function addAssetClip(trackId: string, frame: number, rel: string): Promise<number | null> {
  const s = useStore.getState();
  const track = s.project?.tracks.find((t) => t.id === trackId);
  if (!track || !s.project) return null;
  if (!acceptsMedia(track.kind, rel)) {
    s.set({ notice: `${rel} cannot be placed on track ${track.name}` });
    return null;
  }
  const key = mediaFieldKey(track);
  if (!key) {
    s.set({ notice: `Track ${track.name} has no media column` });
    return null;
  }
  const dur = await assetDurationFrames(rel, s.project.settings.fps);
  let id: string | null = null;
  useStore.getState().edit((d) => {
    id = addClip(d, trackId, frame, dur, { [key]: rel });
  });
  if (!id) {
    useStore.getState().set({ notice: "There is already a clip at that position" });
    return null;
  }
  useStore.getState().select({ trackId, clipId: id });
  const p = useStore.getState().project!;
  return endF(getClip(p, { trackId, clipId: id }), p.settings.fps);
}

/** Deletes the selected clip; with ripple the following clips move up to close the gap. */
export function deleteSelected(ripple = false) {
  const { selection, edit, select } = useStore.getState();
  if (!selection) return;
  edit((d) => removeClip(d, selection, ripple));
  select(null);
}

/** Splits the selected clip at the playhead, or every clip under the playhead when nothing is selected. */
export function splitAtPlayhead() {
  const { selection, playhead, project, edit } = useStore.getState();
  if (!project) return;
  const fps = project.settings.fps;
  edit((d) => {
    if (selection) {
      splitClip(d, selection, playhead);
      return;
    }
    for (const t of d.tracks) {
      const c = clipAt(t, playhead, fps);
      if (c) splitClip(d, { trackId: t.id, clipId: c.id }, playhead);
    }
  });
}

/** Alt+[ / Alt+]: sets the selected clip's IN (start) or OUT (end) to the playhead, like After Effects. */
export function trimSelectedToPlayhead(edge: "start" | "end") {
  const { selection, playhead, project, edit, set } = useStore.getState();
  if (!project) return;
  if (!selection) {
    set({ notice: "Select a clip first (Alt+[ sets its IN, Alt+] its OUT to the playhead)" });
    return;
  }
  edit((d) => trimClip(d, selection, edge, playhead));
}

/** Renames a file in assets/ and updates every clip that uses it (also in the undo history). */
export async function renameAsset(rel: string, newName: string): Promise<boolean> {
  const { dir } = useStore.getState();
  if (!dir || !newName.trim()) return false;
  try {
    const to = await renameAssetFile(dir, rel, newName.trim());
    if (to !== rel)
      useStore.getState().rewriteAll((d) => {
        renameMediaRefs(d, rel, to);
        renameAssetInGroups(d, rel, to);
      });
    await refreshAssets();
    return true;
  } catch (e) {
    useStore.setState({ notice: `Rename failed: ${e}` });
    return false;
  }
}
