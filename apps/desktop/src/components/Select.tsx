import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional colour swatch (e.g. theme preview). */
  swatch?: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional muted hint shown after the label. */
  hint?: string;
  /** Optional group header rendered above the first option of each group. */
  group?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  minWidth?: number | string;
  /** Horizontal alignment of the popover relative to the trigger. */
  align?: "left" | "right";
  /** Open the list on mount (inline editors that enter edit mode ready to pick). */
  autoOpen?: boolean;
  /** Fired when the list is dismissed WITHOUT a selection (outside click / Escape / scroll). */
  onClose?: () => void;
  /** Compact sizing for inline use (e.g. a `.base` table cell). */
  size?: "sm" | "md";
}

/**
 * Fully styled, theme-aware select that replaces the native <select>. The list
 * is positioned with `position: fixed` (computed from the trigger rect) so it is
 * never clipped by a scrolling container, and closes on outside click or Escape.
 * Scrolling inside the option list is ignored; scrolling any ancestor repositions
 * the list to the trigger (it only dismisses once the trigger leaves the viewport).
 * Keyboard: Arrow/Home/End to move, Enter to choose.
 */
export function Select({ value, options, onChange, ariaLabel, disabled, minWidth = 150, align = "left", autoOpen = false, onClose, size = "md" }: SelectProps) {
  const [open, setOpen] = useState(autoOpen);
  const [activeIdx, setActiveIdx] = useState(() => {
    const i = options.findIndex((o) => o.value === value);
    return i >= 0 ? i : 0;
  });
  const [pos, setPos] = useState<{ left: number; top: number; width: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sm = size === "sm";

  const selected = options.find((o) => o.value === value);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 240 && r.top > spaceBelow;
    setPos({ left: r.left, top: openUp ? r.top : r.bottom, width: r.width, openUp });
  };

  const openMenu = () => {
    if (disabled) return;
    place();
    const idx = options.findIndex((o) => o.value === value);
    setActiveIdx(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  // Dismiss without choosing (outside click / Escape / trigger scrolled away):
  // notify the host so an inline editor can leave its edit mode. Selection closes
  // via onChange.
  const dismiss = () => {
    setOpen(false);
    onClose?.();
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    // Scrolling inside the option list must not close it (picking a value from a
    // long list requires scrolling). Ancestor scrolls re-anchor the fixed list to
    // the trigger; only a trigger that left the viewport dismisses.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { dismiss(); return; }
      place();
    };
    const onResize = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (dir: 1 | -1) => {
    setActiveIdx((i) => {
      let n = i;
      for (let step = 0; step < options.length; step++) {
        n = (n + dir + options.length) % options.length;
        if (!options[n].disabled) return n;
      }
      return i;
    });
  };

  const choose = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); triggerRef.current?.focus(); dismiss(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActiveIdx(options.findIndex((o) => !o.disabled)); }
    else if (e.key === "End") { e.preventDefault(); for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setActiveIdx(i); break; } }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIdx];
      if (opt) choose(opt);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? dismiss() : openMenu())}
        onKeyDown={onKeyDown}
        style={{
          display: "flex", alignItems: "center", gap: sm ? "0.4rem" : "0.6rem", minWidth, width: "100%",
          height: sm ? "28px" : "38px", padding: sm ? "0 0.4rem 0 0.5rem" : "0 0.6rem 0 0.7rem", boxSizing: "border-box",
          background: "var(--bg-primary)", border: `1px solid ${open ? "var(--accent-color)" : "var(--border-color)"}`,
          borderRadius: sm ? "var(--radius-sm)" : "var(--radius-md)", color: "var(--text-main)", fontSize: sm ? "0.8rem" : "0.85rem", fontWeight: 500,
          cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
        }}
      >
        {selected?.swatch && <span style={{ width: 14, height: 14, borderRadius: "var(--radius-xs)", flexShrink: 0, background: selected.swatch }} />}
        {selected?.icon && <span style={{ display: "flex", flexShrink: 0, color: "var(--text-muted)" }}>{selected.icon}</span>}
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label ?? value}
        </span>
        <ChevronDown size={sm ? 14 : 15} style={{ color: "var(--text-muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s" }} />
      </button>

      {open && pos && (
        <div
          ref={listRef}
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          style={{
            position: "fixed", zIndex: 4000,
            left: align === "right" ? undefined : pos.left,
            right: align === "right" ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
            top: pos.openUp ? undefined : pos.top + 6,
            bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
            minWidth: pos.width,
            background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-lg)",
            padding: "5px", boxShadow: "0 14px 34px -12px var(--overlay-bg)", display: "flex", flexDirection: "column", gap: "2px",
            maxHeight: "min(320px, 60vh)", overflowY: "auto",
          }}
        >
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            const isActive = i === activeIdx;
            const showGroup = opt.group != null && opt.group !== (i > 0 ? options[i - 1].group : undefined);
            return (
              <Fragment key={opt.value}>
                {showGroup && (
                  <div aria-hidden="true" style={{ padding: "0.35rem 0.6rem 0.15rem", fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                    {opt.group}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setActiveIdx(i)}
                  onClick={() => choose(opt)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.6rem", padding: sm ? "0.35rem 0.5rem" : "0.5rem 0.6rem", borderRadius: "var(--radius-sm)",
                    border: "none", background: isActive && !opt.disabled ? "var(--bg-hover)" : "transparent",
                    color: "var(--text-main)", fontSize: sm ? "0.8rem" : "0.85rem", textAlign: "left", width: "100%",
                    cursor: opt.disabled ? "default" : "pointer", opacity: opt.disabled ? 0.5 : 1,
                  }}
                >
                  {opt.swatch && <span style={{ width: 14, height: 14, borderRadius: "var(--radius-xs)", flexShrink: 0, background: opt.swatch }} />}
                  {opt.icon && <span style={{ display: "flex", flexShrink: 0, color: "var(--text-muted)" }}>{opt.icon}</span>}
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  {opt.hint && <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{opt.hint}</span>}
                  {isSel && <Check size={15} style={{ color: "var(--accent-color)", flexShrink: 0 }} />}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}
