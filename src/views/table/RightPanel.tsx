import { type RightTab, useStore } from "../../store/store";
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
        {project.tracks.map((t) => (
          <button
            key={t.id}
            className={`subtab kind-${t.kind} ${track.id === t.id ? "active" : ""}`}
            onClick={() => set({ conteTrack: t.id })}
            title={`${t.name} (${t.id})`}
          >
            <span className="dot" />
            {t.name}
            <span className="tab-count">{t.clips.length}</span>
          </button>
        ))}
        <button className="subtab add" onClick={() => set({ addTrackOpen: true })} title="Add track">
          ＋
        </button>
      </div>
      <div className="conte-body">
        <TrackTable key={track.id} track={track} />
      </div>
    </div>
  );
}

function AssetsTab() {
  return <AssetPanel />;
}
