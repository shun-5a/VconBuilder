/**
 * Assets tab: the files of assets/ as thumbnail grids, one collapsible section per group
 * (plus "Ungrouped"). Groups only organise the view; files stay in assets/.
 */
import { useRef, useState } from "react";
import { assetUrl, joinPath, revealPath } from "../../io/backend";
import { ASSET_MIME, importDrop, isAcceptableDrag, snapshotDrop } from "../../io/dnd";
import { addGroup, assignAssets, deleteGroup, filesInGroup, moveGroup, renameGroup, UNGROUPED } from "../../model/assetGroups";
import { mediaKind } from "../../render/media";
import { useStore } from "../../store/store";
import { renameAsset } from "../actions";
import { Popover } from "../Popover";

/** Selected assets dragged inside the panel (JSON array of paths). */
const ASSETS_MIME = "application/x-vcon-assets";

const fileName = (rel: string) => rel.replace(/^assets\//, "");

type Menu = { x: number; y: number } & ({ kind: "file"; rel: string } | { kind: "group"; group: string });

export function AssetPanel() {
  const dir = useStore((s) => s.dir)!;
  const project = useStore((s) => s.project)!;
  const assets = useStore((s) => s.assets);
  const collapsed = useStore((s) => s.collapsedGroups);
  const set = useStore((s) => s.set);
  const edit = useStore((s) => s.edit);

  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // asset path, or "group:<name>"
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);

  const groups = project.assetGroups.groups;
  const ungrouped = filesInGroup(project, UNGROUPED, assets);
  const sections = [...groups, UNGROUPED];
  const ordered = sections.flatMap((g) => filesInGroup(project, g, assets)); // for shift-selection

  const toggleCollapsed = (group: string) =>
    set({ collapsedGroups: collapsed.includes(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group] });

  const newGroup = () => {
    let name = "";
    edit((d) => {
      name = addGroup(d);
    });
    setRenaming(`group:${name}`);
  };

  /** Drop onto a group section: moves the dragged assets there, or imports external files into it. */
  const dropInto = async (group: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropGroup(null);
    const list = e.dataTransfer.getData(ASSETS_MIME);
    if (list) {
      edit((d) => assignAssets(d, JSON.parse(list) as string[], group));
      setSelected([]);
      return;
    }
    const paths = await importDrop(snapshotDrop(e.dataTransfer));
    if (paths.length && group) edit((d) => assignAssets(d, paths, group));
  };

  const dropProps = (group: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isAcceptableDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropGroup(group);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropGroup((g) => (g === group ? null : g));
    },
    onDrop: (e: React.DragEvent) => void dropInto(group, e),
  });

  const clickFile = (e: React.MouseEvent, rel: string) => {
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(rel) ? s.filter((x) => x !== rel) : [...s, rel]));
    else if (e.shiftKey && selected.length) {
      const a = ordered.indexOf(selected[selected.length - 1]);
      const b = ordered.indexOf(rel);
      setSelected(ordered.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else setSelected([rel]);
  };

  const tile = (rel: string) => {
    const kind = mediaKind(rel);
    const url = assetUrl(dir, rel);
    const isSelected = selected.includes(rel);
    return (
      <div
        key={rel}
        className={`asset ${isSelected ? "selected" : ""}`}
        draggable={renaming !== rel}
        title={`${rel}\nDrag onto the timeline or another group · double-click the name to rename`}
        onClick={(e) => clickFile(e, rel)}
        onDragStart={(e) => {
          const group = isSelected ? selected : [rel];
          e.dataTransfer.setData(ASSET_MIME, rel); // the timeline takes one asset
          e.dataTransfer.setData(ASSETS_MIME, JSON.stringify(group));
          e.dataTransfer.setData("text/plain", rel);
          e.dataTransfer.effectAllowed = "copyMove";
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isSelected) setSelected([rel]);
          setMenu({ x: e.clientX, y: e.clientY, kind: "file", rel });
        }}
      >
        <div className="asset-thumb">
          {kind === "image" && <img src={url} alt="" draggable={false} loading="lazy" />}
          {kind === "video" && <video src={`${url}#t=0.5`} muted preload="metadata" />}
          {kind === "audio" && "♪"}
          {!kind && "?"}
        </div>
        {renaming === rel ? (
          <FileRenameInput rel={rel} onDone={() => setRenaming(null)} />
        ) : (
          <div className="asset-name" onDoubleClick={() => setRenaming(rel)}>
            {fileName(rel)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="conte">
      <div className="pane-header">
        <span className="dim small">{assets.length} files</span>
        <div className="spacer" />
        <button onClick={newGroup} title="New group (groups only organise this tab; files stay in assets/)">
          ＋Group
        </button>
        <button onClick={() => revealPath(joinPath(dir, "assets"))}>Open assets folder</button>
      </div>
      <div className="conte-body">
        <div className="asset-groups" onPointerDown={(e) => e.target === e.currentTarget && setSelected([])} {...dropProps(UNGROUPED)}>
          {assets.length === 0 && (
            <div className="empty-hint">
              Drop images, videos or audio from the file manager or a browser here to import them into assets/.
              <br />
              Files placed directly in the assets/ folder show up automatically.
            </div>
          )}
          {sections.map((group) => {
            const files = group ? filesInGroup(project, group, assets) : ungrouped;
            // "Ungrouped" only gets a header once groups exist.
            if (!group && !groups.length) {
              return (
                <div key="(ungrouped)" className="assets">
                  {files.map(tile)}
                </div>
              );
            }
            if (!group && !files.length) return null;
            const folded = collapsed.includes(group);
            return (
              <section key={group || "(ungrouped)"} className={`asset-group ${dropGroup === group ? "drop" : ""}`} {...dropProps(group)}>
                <div
                  className="asset-group-head"
                  onClick={() => toggleCollapsed(group)}
                  onContextMenu={(e) => {
                    if (!group) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ x: e.clientX, y: e.clientY, kind: "group", group });
                  }}
                >
                  <span className="caret">{folded ? "▸" : "▾"}</span>
                  {renaming === `group:${group}` ? (
                    <NameInput
                      initial={group}
                      onDone={(name) => {
                        if (name) edit((d) => void renameGroup(d, group, name));
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <span
                      className="group-name"
                      onDoubleClick={(e) => {
                        if (!group) return;
                        e.stopPropagation();
                        setRenaming(`group:${group}`);
                      }}
                    >
                      {group || "Ungrouped"}
                    </span>
                  )}
                  <span className="tab-count">{files.length}</span>
                </div>
                {!folded && (
                  <div className="assets">
                    {files.map(tile)}
                    {!files.length && <div className="dim small group-empty">Drag assets here</div>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <Popover at={menu} open={!!menu} onClose={() => setMenu(null)}>
        {menu?.kind === "file" && (
          <>
            <button
              className="ghost"
              onClick={() => {
                setRenaming(menu.rel);
                setMenu(null);
              }}
            >
              Rename
            </button>
            {groups.length > 0 && (
              <>
                <div className="menu-heading">Move {selected.length > 1 ? `${selected.length} items ` : ""}to group</div>
                {[...groups, UNGROUPED].map((g) => (
                  <button
                    key={g || "(ungrouped)"}
                    className="ghost"
                    onClick={() => {
                      const rels = selected.includes(menu.rel) ? selected : [menu.rel];
                      edit((d) => assignAssets(d, rels, g));
                      setSelected([]);
                      setMenu(null);
                    }}
                  >
                    {g || "Ungrouped"}
                  </button>
                ))}
              </>
            )}
            <div className="menu-sep" />
            <button
              className="ghost"
              onClick={() => {
                void revealPath(joinPath(dir, menu.rel));
                setMenu(null);
              }}
            >
              Show in folder
            </button>
          </>
        )}
        {menu?.kind === "group" && (
          <>
            <button
              className="ghost"
              onClick={() => {
                setRenaming(`group:${menu.group}`);
                setMenu(null);
              }}
            >
              Rename
            </button>
            <button
              className="ghost"
              onClick={() => {
                edit((d) => moveGroup(d, menu.group, -1));
                setMenu(null);
              }}
            >
              Move up
            </button>
            <button
              className="ghost"
              onClick={() => {
                edit((d) => moveGroup(d, menu.group, 1));
                setMenu(null);
              }}
            >
              Move down
            </button>
            <div className="menu-sep" />
            <button
              className="ghost"
              title="The group is removed; its files become ungrouped"
              onClick={() => {
                edit((d) => deleteGroup(d, menu.group));
                setMenu(null);
              }}
            >
              Delete group (keep its files)
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

/** Inline name editor; calls onDone with the new name ("" = unchanged / cancelled). */
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string) => {
    if (done.current) return;
    done.current = true;
    onDone(name.trim() && name.trim() !== initial ? name.trim() : "");
  };
  return (
    <input
      className="asset-rename group-rename"
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") finish("");
      }}
    />
  );
}

/** Inline file-name editor; the extension stays when it is left out. Clips using the file are updated. */
function FileRenameInput({ rel, onDone }: { rel: string; onDone: () => void }) {
  const name = fileName(rel);
  const dot = name.lastIndexOf(".");
  const [value, setValue] = useState(name);
  // Escape ends editing without renaming; the blur that follows (or unmounting) must not commit.
  const done = useRef(false);
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    if (value.trim() && value.trim() !== name) await renameAsset(rel, value.trim());
    onDone();
  };
  return (
    <input
      className="asset-rename"
      autoFocus
      value={value}
      // Select the base name only, like a file manager.
      onFocus={(e) => e.target.setSelectionRange(0, dot > 0 ? dot : name.length)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          done.current = true;
          onDone();
        }
      }}
    />
  );
}
