import { useState } from "react";
import { addTrack, defaultTrackName } from "../model/ops";
import type { TrackKind } from "../model/schema";
import { useStore } from "../store/store";

const KINDS: { kind: TrackKind; title: string }[] = [
  { kind: "visual", title: "Visual track" },
  { kind: "audio", title: "Audio track" },
  { kind: "text", title: "Text track" },
];

/** Picks the kind of a new track and its name. */
export function AddTrackDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const [kind, setKind] = useState<TrackKind>("visual");
  const [name, setName] = useState("");

  const add = () => {
    let id = "";
    // addTrack also shows a new visual track in every preset.
    useStore.getState().edit((d) => {
      id = addTrack(d, kind, name);
    });
    useStore.setState({ rightTab: "conte", conteTrack: id });
    onClose();
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-head">Add track</div>
        <div className="modal-body">
          <div className="kind-choices">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                className={`kind-choice kind-${k.kind} ${kind === k.kind ? "on" : ""}`}
                onClick={() => setKind(k.kind)}
                onDoubleClick={add}
              >
                <span className="kind-title">
                  <span className="dot" /> {k.title}
                </span>
              </button>
            ))}
          </div>
          <div className="form" style={{ marginTop: 12 }}>
            <label>Name</label>
            <input
              autoFocus
              value={name}
              placeholder={defaultTrackName(project, kind)}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </div>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
