import { useEffect } from "react";
import { useStore } from "../store/store";

export type UnsavedChoice = "save" | "discard" | "cancel";

/** Opens the "not saved" dialog and resolves with the user's choice. */
export function askUnsaved(): Promise<UnsavedChoice> {
  const pending = useStore.getState().unsavedPrompt;
  if (pending) return Promise.resolve("cancel"); // already asking (e.g. close clicked twice)
  return new Promise((resolve) => useStore.setState({ unsavedPrompt: resolve }));
}

export function UnsavedDialog() {
  const resolve = useStore((s) => s.unsavedPrompt);
  const answer = (c: UnsavedChoice) => {
    useStore.setState({ unsavedPrompt: null });
    resolve?.(c);
  };

  useEffect(() => {
    if (!resolve) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        answer("cancel");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!resolve) return null;
  return (
    <div className="modal-back">
      <div className="modal small" role="alertdialog" aria-labelledby="unsaved-title">
        <div className="modal-head" id="unsaved-title">
          This project is not in a folder yet.
        </div>
        <div className="modal-body">
          Save it to a folder to keep it. Otherwise the untitled project and the assets imported into it will be deleted.
        </div>
        <div className="modal-foot">
          <button onClick={() => answer("discard")}>Don't Save</button>
          <div className="spacer" />
          <button onClick={() => answer("cancel")}>Cancel</button>
          <button className="primary" autoFocus onClick={() => answer("save")}>
            Save to folder…
          </button>
        </div>
      </div>
    </div>
  );
}
