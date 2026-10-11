/** Markdown / CSV export. */

import { projectToMarkdown, trackToCsv } from "../model/textExport";
import { useStore } from "../store/store";
import { joinPath, writeTextAtomic } from "./backend";

const pad = (n: number) => String(n).padStart(2, "0");
export function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const safeFileName = (s: string) => s.replace(/[<>:"/\\|?*\s]+/g, "_");

const projectName = (dir: string) =>
  dir
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || "project";

function notify(msg: string) {
  useStore.setState({ notice: msg });
}

export async function exportMarkdown() {
  const { dir, project } = useStore.getState();
  if (!dir || !project) return;
  const name = projectName(dir);
  const rel = `exports/${safeFileName(name)}_${timestamp()}.md`;
  await writeTextAtomic(joinPath(dir, rel), projectToMarkdown(project, name));
  notify(`Wrote ${rel}`);
}

export async function exportCsv(trackId: string) {
  const { dir, project } = useStore.getState();
  const track = project?.tracks.find((t) => t.id === trackId);
  if (!dir || !project || !track) return;
  const rel = `exports/${safeFileName(track.name)}_${timestamp()}.csv`;
  await writeTextAtomic(joinPath(dir, rel), trackToCsv(project, track));
  notify(`Wrote ${rel}`);
}
