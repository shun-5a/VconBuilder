import type { Dialog } from "../App";
import { projectFile, revealPath } from "../io/backend";
import { getRecentProjects } from "../io/project";
import { exportCsv, exportMarkdown } from "../io/textio";
import { useStore } from "../store/store";
import { Menu, type MenuItem } from "./Menu";
import { newProject, openProject, saveToFolder } from "./projectActions";

const folderName = (dir: string) =>
  dir
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? dir;

/** Menubar (File / Edit) plus the project name. */
export function Toolbar({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const dir = useStore((s) => s.dir)!;
  const untitled = useStore((s) => s.untitled);
  const settings = useStore((s) => s.project!.settings);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tracks = useStore((s) => s.project!.tracks);
  const { undo, redo, set } = useStore.getState();
  const fail = (e: unknown) => set({ notice: `Failed: ${e}` });
  const recents = getRecentProjects().filter((d) => d !== dir);

  const fileItems: MenuItem[] = [
    { label: "New", shortcut: "Ctrl+N", onClick: () => void newProject() },
    { label: "Open…", shortcut: "Ctrl+O", onClick: () => void openProject() },
    ...(recents.length
      ? ([
          { heading: "Open recent" },
          ...recents.slice(0, 6).map((d) => ({ label: folderName(d), title: d, onClick: () => void openProject(d) })),
        ] as MenuItem[])
      : []),
    "separator",
    untitled
      ? {
          label: "Save to folder…",
          shortcut: "Ctrl+S",
          onClick: () => void saveToFolder(),
          title: "Give the project a folder (changes are saved automatically from then on)",
        }
      : {
          label: "Save a copy…",
          shortcut: "Ctrl+Shift+S",
          onClick: () => void saveToFolder(),
          title: "Copy the project and its assets into a new folder (you keep working on this one)",
        },
    "separator",
    { label: "Export video…", onClick: () => onDialog("export"), title: "Render the preview as an H.264 mp4" },
    { label: "Export Markdown", onClick: () => void exportMarkdown().catch(fail), title: "Writes exports/<project>_<time>.md" },
    ...tracks.map((t) => ({ label: `Export CSV: ${t.name}`, onClick: () => void exportCsv(t.id).catch(fail) })),
    ...(untitled
      ? []
      : (["separator", { label: "Show project folder", onClick: () => void projectFile(dir).then(revealPath), title: dir }] as MenuItem[])),
  ];

  const editItems: MenuItem[] = [
    { label: "Undo", shortcut: "Ctrl+Z", onClick: undo, disabled: !canUndo },
    { label: "Redo", shortcut: "Ctrl+Y", onClick: redo, disabled: !canRedo },
    "separator",
    { label: `Project settings… (${settings.width}×${settings.height} / ${settings.fps}fps)`, onClick: () => onDialog("settings") },
  ];

  return (
    <div className="toolbar menubar">
      <Menu bar label="File" items={fileItems} />
      <Menu bar label="Edit" items={editItems} />
      <div className="spacer" />
      <span className="path" title={untitled ? "Not in a folder yet: kept in the app data folder until you save it to a folder" : dir}>
        {untitled ? "Untitled project*" : folderName(dir)}
      </span>
      <div className="spacer" />
    </div>
  );
}
