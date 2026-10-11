import { useRef, useState } from "react";
import { Popover } from "./Popover";

export type MenuItem =
  | { label: string; onClick: () => void; title?: string; shortcut?: string; disabled?: boolean }
  | { heading: string }
  | "separator";

/**
 * Button that opens a dropdown list; closes on selection, outside click or Escape.
 * `bar` renders it as a menubar entry ("File", "Edit") instead of a "Label ▾" button.
 */
export function Menu({
  label,
  items,
  title,
  align = "left",
  bar = false,
}: {
  label: string;
  items: MenuItem[];
  title?: string;
  align?: "left" | "right";
  bar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={ref} className={`${bar ? "menubar-item" : ""} ${open ? "on" : ""}`} onClick={() => setOpen(!open)} title={title}>
        {label}
        {bar ? "" : " ▾"}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align={align} className={bar ? "menubar-list" : ""}>
        {items.map((it, i) => {
          // Menus are static lists that never reorder, so the position is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: static menu items
          if (it === "separator") return <div key={i} className="menu-sep" />;
          if ("heading" in it)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static menu items
              <div key={i} className="menu-heading">
                {it.heading}
              </div>
            );
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: static menu items
              key={i}
              className="ghost menu-item"
              title={it.title}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            </button>
          );
        })}
      </Popover>
    </>
  );
}
