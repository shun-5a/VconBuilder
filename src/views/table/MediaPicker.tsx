import { useState } from "react";
import { assetUrl } from "../../io/backend";
import { groupOf, UNGROUPED } from "../../model/assetGroups";
import { mediaKind } from "../../render/media";
import { useStore } from "../../store/store";
import { Popover } from "../Popover";

const fileName = (rel: string) => rel.replace(/^assets\//, "");

/** Small preview of an asset: the image, the first frame of a video, or a note sign for audio. */
function Thumb({ dir, rel }: { dir: string; rel: string }) {
  const kind = mediaKind(rel);
  const url = assetUrl(dir, rel);
  if (kind === "image") return <img className="pick-thumb" src={url} alt="" loading="lazy" draggable={false} />;
  if (kind === "video") return <video className="pick-thumb" src={`${url}#t=0.1`} muted preload="metadata" />;
  return <span className="pick-thumb pick-audio">♪</span>;
}

/**
 * Chooses a media file for a cell: thumbnails grouped like the Assets tab, each group collapsible.
 * Groups start collapsed as in the Assets tab, except the one holding the current value.
 */
export function MediaPicker({
  anchor,
  open,
  choices,
  value,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** Assets this column accepts, in Assets-tab order. */
  choices: string[];
  value: string;
  onPick: (rel: string | null) => void;
  onClose: () => void;
}) {
  const dir = useStore((s) => s.dir)!;
  const project = useStore((s) => s.project)!;
  useStore((s) => s.assetEpoch); // re-render with new URLs when files are replaced on disk
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const own = value ? groupOf(project, value) : null;
    return useStore.getState().collapsedGroups.filter((g) => g !== own);
  });

  const groups = [...project.assetGroups.groups, UNGROUPED]
    .map((g) => ({ name: g, files: choices.filter((rel) => groupOf(project, rel) === g) }))
    .filter((g) => g.files.length > 0);
  const toggle = (g: string) => setCollapsed((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g]));

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} className="media-picker">
      <button className={`ghost pick-row ${value ? "" : "on"}`} onClick={() => onPick(null)}>
        <span className="pick-thumb pick-none">–</span>
        (none)
      </button>
      {groups.length === 0 && <div className="dim small pick-empty">No matching files in assets/ yet</div>}
      {groups.map((g) => {
        const isCollapsed = collapsed.includes(g.name);
        // A single "Ungrouped" section needs no header.
        const header = groups.length > 1 || g.name !== UNGROUPED;
        return (
          <div key={g.name || "\u0000ungrouped"} className="pick-group">
            {header && (
              <button className="ghost pick-group-head" onClick={() => toggle(g.name)}>
                <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                {g.name || "Ungrouped"}
                <span className="dim small">{g.files.length}</span>
              </button>
            )}
            {!(header && isCollapsed) &&
              g.files.map((rel) => (
                <button key={rel} className={`ghost pick-row ${rel === value ? "on" : ""}`} title={rel} onClick={() => onPick(rel)}>
                  <Thumb dir={dir} rel={rel} />
                  <span className="pick-name">{fileName(rel)}</span>
                </button>
              ))}
          </div>
        );
      })}
    </Popover>
  );
}
