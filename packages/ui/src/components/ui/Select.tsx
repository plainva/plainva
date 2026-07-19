import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cx } from "./cx";
import { ICON } from "../../lib/iconSizes";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Optional colour swatch (e.g. calendar/theme colors). */
  swatch?: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional muted hint right of the label (shortcut, count). */
  hint?: string;
  /** Optional second line under the label. */
  description?: string;
  /** Optional group header rendered above the first option of each group. */
  group?: string;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  minWidth?: number | string;
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: "left" | "right";
  /** Open the list on mount (inline editors that enter edit mode ready to pick). */
  autoOpen?: boolean;
  /** Fired when the list is dismissed WITHOUT a selection (outside click / Escape / scroll-away). */
  onClose?: () => void;
  /** Dense chrome contexts (toolbars, inline table cells) — form metric otherwise. */
  compact?: boolean;
  /** Search row placeholder; the row auto-appears at >= 8 options. */
  searchPlaceholder?: string;
  className?: string;
  "data-testid"?: string;
}

/** Options threshold at which the panel grows a search row. */
const SEARCH_AT = 8;

/**
 * Select (design sweep 2026-07-19, E11): the app-wide dropdown. Trigger in the
 * exact .pv-field look of its metric role + rotating chevron; the open panel
 * follows the popover contract (radius-md, shadow-2, z-menu) with menu-metric
 * options — the chosen one carries the accent container + a check in the icon
 * slot; >= 8 options grow a search row. The panel is ours, so every theme
 * (LCARS pills, Win95 bevels, dark) reaches it — native <select> stays
 * reserved for very long OS-like lists (fonts, languages) via SelectField.
 * The fixed panel re-anchors on ancestor scroll and dismisses only once the
 * trigger leaves the viewport (inherited from the proven previous Select).
 */
export function Select<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
  minWidth = 150,
  align = "left",
  autoOpen = false,
  onClose,
  compact,
  searchPlaceholder,
  className,
  "data-testid": testId,
}: SelectProps<T>) {
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(() => {
    const i = options.findIndex((o) => o.value === value);
    return i >= 0 ? i : 0;
  });
  const [pos, setPos] = useState<{ left: number; top: number; width: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const searchable = options.length >= SEARCH_AT;
  const shown = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.hint?.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q)
    );
  }, [options, query]);

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
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActiveIdx(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  // Dismiss without choosing (outside click / Escape / trigger scrolled away):
  // notify the host so an inline editor can leave its edit mode.
  const dismiss = () => {
    setOpen(false);
    onClose?.();
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    // Scrolling inside the option list must not close it; ancestor scrolls
    // re-anchor the fixed list to the trigger; only a trigger that left the
    // viewport dismisses.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        dismiss();
        return;
      }
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
  }, [open, searchable]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  useEffect(() => {
    if (activeIdx >= shown.length) setActiveIdx(Math.max(0, shown.length - 1));
  }, [shown.length, activeIdx]);

  const move = (dir: 1 | -1) => {
    setActiveIdx((i) => {
      let n = i;
      for (let step = 0; step < shown.length; step += 1) {
        n = (n + dir + shown.length) % shown.length;
        if (!shown[n]?.disabled) return n;
      }
      return i;
    });
  };

  const choose = (opt: SelectOption<T>) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        setQuery("");
      } else {
        triggerRef.current?.focus();
        dismiss();
      }
    } else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActiveIdx(shown.findIndex((o) => !o.disabled)); }
    else if (e.key === "End") {
      e.preventDefault();
      for (let i = shown.length - 1; i >= 0; i -= 1) {
        if (!shown[i].disabled) { setActiveIdx(i); break; }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = shown[activeIdx];
      if (opt) choose(opt);
    } else if (e.key === "Tab") {
      dismiss();
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
        data-testid={testId}
        className={cx("pv-field", "pv-selecttrigger", compact && "pv-field--compact", className)}
        style={{ minWidth }}
        onClick={() => (open ? dismiss() : openMenu())}
        onKeyDown={onKeyDown}
      >
        {selected?.swatch ? <span className="pv-selectopt-swatch" style={{ background: selected.swatch, marginTop: 0 }} /> : null}
        {selected?.icon ? <span className="pv-selecttrigger-ic">{selected.icon}</span> : null}
        <span className={cx("pv-selecttrigger-val", !selected && "is-placeholder")}>
          {selected?.label ?? placeholder ?? String(value)}
        </span>
        <ChevronDown size={compact ? ICON.meta : ICON.ui} aria-hidden />
      </button>

      {open && pos ? (
        <div
          ref={listRef}
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          className="pv-selectpanel"
          onKeyDown={onKeyDown}
          style={{
            position: "fixed",
            zIndex: "var(--z-menu)" as unknown as number,
            left: align === "right" ? undefined : pos.left,
            right: align === "right" ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
            top: pos.openUp ? undefined : pos.top + 6,
            bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
            minWidth: pos.width,
          }}
        >
          {searchable ? (
            <div className="pv-selectsearch">
              <Search size={ICON.meta} aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
              />
            </div>
          ) : null}
          {shown.map((opt, i) => {
            const isSel = opt.value === value;
            const isActive = i === activeIdx;
            const showGroup = !query && opt.group != null && opt.group !== (i > 0 ? shown[i - 1].group : undefined);
            return (
              <Fragment key={opt.value}>
                {showGroup ? (
                  <div aria-hidden="true" className="pv-popover-label">{opt.group}</div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  disabled={opt.disabled}
                  data-idx={i}
                  className={cx("pv-selectopt", isSel && "is-selected", isActive && !isSel && "is-hilite")}
                  onMouseEnter={() => !opt.disabled && setActiveIdx(i)}
                  onClick={() => choose(opt)}
                >
                  <span className="pv-selectopt-ic">{isSel ? <Check size={ICON.ui} /> : opt.icon ?? null}</span>
                  {opt.swatch ? <span className="pv-selectopt-swatch" style={{ background: opt.swatch }} /> : null}
                  <span className="pv-selectopt-body">
                    <span className="pv-selectopt-label">{opt.label}</span>
                    {opt.description ? <span className="pv-selectopt-desc">{opt.description}</span> : null}
                  </span>
                  {opt.hint ? <span className="pv-selectopt-hint">{opt.hint}</span> : null}
                </button>
              </Fragment>
            );
          })}
          {shown.length === 0 ? <div className="pv-popover-empty">–</div> : null}
        </div>
      ) : null}
    </>
  );
}
