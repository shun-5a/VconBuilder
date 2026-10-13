import { useState } from "react";
import { type RightTab, useStore } from "../../store/store";
import { deleteTrackWithConfirm, renameTrack } from "../actions";
import { Popover } from "../Popover";
import { AssetPanel } from "./AssetPanel";
import { TrackTable } from "./TrackTable";

/** Right side: Conte (one table per track, chosen with track tabs) and Assets. */
export function RightPanel() {
  const rightTab = useStore((s) => s.rightTab);
  const assetCount = useStore((s) => s.assets.length);
  const set = useStore((s) => s.set);

  const tab = (id: RightTab, label: string, count?: number) => (
    <button className={`tab ${rightTab === id ? "active" : ""}`} onClick={() => set({ rightTab: id })}>
      {label}
      {count !== undefined && <span className="tab-count">{count}</span>}
    </button>
  );

  return (
    <div className="pane">
      <div className="tabs">
        {tab("conte", "Conte")}
        {tab("assets", "Assets", assetCount)}
      </div>
      <div className="pane-body">
        {rightTab === "conte" && <ContePanel />}
        {rightTab === "assets" && <AssetsTab />}
      </div>
    </div>
  );
}

function ContePanel() {
  const project = useStore((s) => s.project)!;
  const conteTrack = useStore((s) => s.conteTrack);
  const set = useStore((s) => s.set);
  // A deleted track falls back to the first one.
  const track = project.tracks.find((t) => t.id === conteTrack) ?? project.tracks[0];
  // Right-click on a track tab: rename / delete.
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (!track) {
    return (
      <div className="no-tracks">
        <div className="dim">No tracks yet</div>
        <button className="primary" onClick={() => set({ addTrackOpen: true })}>
          ＋Add track
        </button>
      </div>
    );
  }
  return (
    <div className="conte">
      {/* Scrollbar is hidden; the mouse wheel scrolls the tabs sideways. */}
      <div className="subtabs" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
        {project.tracks.map((t) =>
          renaming === t.id ? (
            <span key={t.id} className={`subtab kind-${t.kind} active`}>
              <span className="dot" />
              <input
                className="subtab-rename"
                autoFocus
                defaultValue={t.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  renameTrack(t.id, e.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            </span>
          ) : (
            <button
              key={t.id}
              className={`subtab kind-${t.kind} ${track.id === t.id ? "active" : ""}`}
              onClick={() => set({ conteTrack: t.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, trackId: t.id });
              }}
              title={`${t.name} (${t.id}) · right-click to rename or delete`}
            >
              <span className="dot" />
              {t.name}
              <span className="tab-count">{t.clips.length}</span>
            </button>
          ),
        )}
        <button className="subtab add" onClick={() => set({ addTrackOpen: true })} title="Add track">
          ＋
        </button>
      </div>
      <Popover at={menu} open={!!menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <button
              className="ghost"
              onClick={() => {
                setRenaming(menu.trackId);
                setMenu(null);
              }}
            >
              Rename
            </button>
            <div className="menu-sep" />
            <button
              className="ghost"
              onClick={() => {
                const t = project.tracks.find((x) => x.id === menu.trackId);
                setMenu(null);
                if (t) void deleteTrackWithConfirm(t);
              }}
            >
              Delete track
            </button>
          </>
        )}
      </Popover>
      <div className="conte-body">
        <TrackTable key={track.id} track={track} />
      </div>
    </div>
  );
}

function AssetsTab() {
  return <AssetPanel />;
}
