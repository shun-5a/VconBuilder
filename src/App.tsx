import { useEffect, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { saveNow, startAutosave } from "./io/project";
import { useStore } from "./store/store";
import { AddTrackDialog } from "./views/AddTrackDialog";
import { ExportDialog } from "./views/preview/ExportDialog";
import { Preview } from "./views/preview/Preview";
import { installCloseGuard } from "./views/projectActions";
import { SettingsDialog } from "./views/SettingsDialog";
import { StartScreen } from "./views/StartScreen";
import { useShortcuts } from "./views/shortcuts";
import { Toolbar } from "./views/Toolbar";
import { RightPanel } from "./views/table/RightPanel";
import { Timeline } from "./views/timeline/Timeline";
import { UnsavedDialog } from "./views/UnsavedDialog";

export type Dialog = "export" | "settings" | null;

export default function App() {
  const project = useStore((s) => s.project);
  const [dialog, setDialog] = useState<Dialog>(null);
  const addTrackOpen = useStore((s) => s.addTrackOpen);
  const asking = useStore((s) => !!s.unsavedPrompt);

  useEffect(() => startAutosave(), []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    installCloseGuard()
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch((e) => console.warn("close guard unavailable", e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    const flush = () => void saveNow();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);
  useShortcuts(!!project && !dialog && !addTrackOpen && !asking);

  if (!project)
    return (
      <>
        <StartScreen />
        <UnsavedDialog />
      </>
    );

  return (
    <div className="app">
      <Toolbar onDialog={setDialog} />
      <Banners />
      <Workspace />
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {addTrackOpen && <AddTrackDialog onClose={() => useStore.setState({ addTrackOpen: false })} />}
      <UnsavedDialog />
    </div>
  );
}

function Workspace() {
  const outer = useDefaultLayout({ id: "vcon-outer", storage: safeStorage });
  const left = useDefaultLayout({ id: "vcon-left", storage: safeStorage });
  return (
    <div className="workspace">
      <Group orientation="horizontal" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged}>
        <Panel id="left" defaultSize="58" minSize="25">
          <Group orientation="vertical" defaultLayout={left.defaultLayout} onLayoutChanged={left.onLayoutChanged}>
            <Panel id="preview" defaultSize="55" minSize="15">
              <Preview />
            </Panel>
            <Separator className="resize-v" />
            <Panel id="timeline" defaultSize="45" minSize="15">
              <Timeline />
            </Panel>
          </Group>
        </Panel>
        <Separator className="resize-h" />
        <Panel id="right" defaultSize="42" minSize="20">
          <RightPanel />
        </Panel>
      </Group>
    </div>
  );
}

/** localStorage can throw (private mode, blocked storage); layouts are just a convenience. */
const safeStorage = {
  getItem(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

function Banners() {
  const loadError = useStore((s) => s.loadError);
  const warnings = useStore((s) => s.warnings);
  const notice = useStore((s) => s.notice);
  const saveError = useStore((s) => s.saveError);
  const set = useStore((s) => s.set);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => set({ notice: null }), 5000);
    return () => clearTimeout(t);
  }, [notice, set]);

  return (
    <>
      {loadError && (
        <div className="banner error">
          <span className="msg">
            The externally edited project file could not be loaded (showing the previous state){"\n"}
            {loadError}
          </span>
          <button className="icon ghost" onClick={() => set({ loadError: null })}>
            ✕
          </button>
        </div>
      )}
      {saveError && (
        <div className="banner error">
          <span className="msg">{saveError}</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner warn">
          <span className="msg">
            {warnings.slice(0, 3).join("\n")}
            {warnings.length > 3 ? `\n…and ${warnings.length - 3} more` : ""}
          </span>
        </div>
      )}
      {notice && (
        <div className="banner info">
          <span className="msg">{notice}</span>
          <button className="icon ghost" onClick={() => set({ notice: null })}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}
