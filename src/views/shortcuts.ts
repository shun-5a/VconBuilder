import { useEffect } from "react";
import { projectEndFrame } from "../model/ops";
import { useStore } from "../store/store";
import { deleteSelected, splitAtPlayhead, trimSelectedToPlayhead } from "./actions";
import { seek, togglePlay } from "./preview/player";
import { newProject, openProject, saveToFolder } from "./projectActions";

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && (key === "s" || key === "n" || key === "o")) {
        e.preventDefault();
        // Ctrl+S only matters for an untitled project (everything else is saved as you go).
        if (key === "s") void ((e.shiftKey || useStore.getState().untitled) && saveToFolder());
        else if (key === "n") void newProject();
        else void openProject();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "z" && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "y" && !isTyping(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e) || !s.project) return;
      const fps = s.project.settings.fps;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(s.playhead - (e.shiftKey ? fps : 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(s.playhead + (e.shiftKey ? fps : 1));
          break;
        case "Home":
          seek(0);
          break;
        case "End":
          seek(projectEndFrame(s.project));
          break;
        case "Delete":
        case "Backspace":
          deleteSelected(e.shiftKey);
          break;
        case "s":
        case "S":
          if (!ctrl) splitAtPlayhead();
          break;
        // After Effects: Alt+[ / Alt+] set the selected clip's IN / OUT to the playhead.
        case "[":
        case "]":
          if (e.altKey) {
            e.preventDefault();
            trimSelectedToPlayhead(e.key === "[" ? "start" : "end");
          }
          break;
        case "k":
          if (ctrl) {
            e.preventDefault();
            splitAtPlayhead();
          }
          break;
        case "Escape":
          s.select(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
