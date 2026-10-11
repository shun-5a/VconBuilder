import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Dropdown rendered into document.body with fixed positioning, so it is never clipped by
 * scrolling/overflow containers (toolbars, pane headers) and always draws on top.
 * Closes on outside click, Escape, window resize or scroll outside it.
 */
export function Popover({
  anchor,
  at,
  open,
  onClose,
  align = "left",
  className = "",
  children,
}: {
  /** Element the popover opens below. */
  anchor?: React.RefObject<HTMLElement | null>;
  /** Or a screen point (context menus). */
  at?: { x: number; y: number } | null;
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const a = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor?.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === "right" ? a.right - w : a.left;
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    // Open upwards when there is no room below.
    const top = a.bottom + 4 + h > window.innerHeight && a.top - 4 - h > 0 ? a.top - 4 - h : a.bottom + 4;
    setPos({ top, left });
  }, [open, anchor, at, align]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => ref.current?.contains(t as Node) || anchor?.current?.contains(t as Node);
    const onDown = (e: PointerEvent) => !inside(e.target) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = (e: Event) => !inside(e.target) && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`menu-list ${className}`}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, right: "auto" }}
    >
      {children}
    </div>,
    document.body,
  );
}
