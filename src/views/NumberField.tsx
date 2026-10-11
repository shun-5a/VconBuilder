import { useRef, useState } from "react";

export type NumberRange = { min: number; max: number; integer?: boolean };

/**
 * Parses a typed number and fits it into the range; null when the text is not a number
 * (empty, "-", "abc"...), so half-typed values are never committed.
 */
export function parseNumberInput(text: string, { min, max, integer }: NumberRange): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const v = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
}

/**
 * Number input that keeps a local draft while typing and commits once on blur / Enter
 * (Escape restores the current value), so intermediate keystrokes never reach the project
 * and every change is a single undo step.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  integer,
  step,
  width,
  title,
  className,
}: NumberRange & {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  /** px; defaults to 70 unless a className sizes the input. */
  width?: number;
  title?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
    } else if (draft !== null) {
      const v = parseNumberInput(draft, { min, max, integer });
      if (v !== null && v !== value) onCommit(v);
    }
    setDraft(null);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step ?? (integer ? 1 : "any")}
      className={className}
      style={{ width: width ?? (className ? undefined : 70) }}
      title={title}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
