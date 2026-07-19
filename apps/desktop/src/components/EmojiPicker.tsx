import React, { useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_CATEGORIES, ICON, searchEmoji } from "@plainva/ui";
import type { EmojiCategoryId, EmojiEntry } from "@plainva/ui";
import { searchLucideIcons, LUCIDE_ICONS } from "@plainva/ui";
import { DocIcon } from "@plainva/ui";
import { ACCENT_PALETTE } from "./palette";

export interface EmojiPickerLabels {
  searchPlaceholder: string;
  recent: string;
  remove: string;
  noResults: string;
  categories: Record<EmojiCategoryId, string>;
  modeEmoji: string;
  modeIcons: string;
  tint: string;
  tintDefault: string;
}

export interface EmojiPickerProps {
  x: number;
  y: number;
  labels: EmojiPickerLabels;
  showRemove?: boolean;
  /** Text-insertion use (e.g. `/emoji`): only the emoji grid, no icon-set mode. */
  emojiOnly?: boolean;
  onSelect: (emoji: string) => void;
  /** Icon-set pick (Notion-like): lucide name + optional tint. */
  onSelectIcon: (name: string, color: string | null) => void;
  onRemove?: () => void;
  onClose: () => void;
}

const RECENT_KEY = "plainva-recent-emoji";
const MAX_RECENT = 24;
const WIDTH = 328;
const MAX_HEIGHT = 420;

// Representative tab glyph per category (the accessible labels come from props).
const CATEGORY_ICONS: Record<EmojiCategoryId, string> = {
  smileys: "😀",
  people: "👋",
  animals: "🐻",
  food: "🍔",
  activities: "⚽",
  travel: "🚗",
  objects: "💡",
  symbols: "❤️",
};

/** Muted tints that work on both themes — shared with the header palette. */
const ICON_TINTS = ACCENT_PALETTE;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecent(char: string, current: string[]): string[] {
  const next = [char, ...current.filter((c) => c !== char)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — recents just won't persist.
  }
  return next;
}

function containsNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

const gridButtonStyle: React.CSSProperties = {
  height: "34px",
  padding: 0,
  fontSize: "var(--text-headline)",
  lineHeight: 1,
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  color: "var(--text-main)",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ x, y, labels, showRemove, emojiOnly, onSelect, onSelectIcon, onRemove, onClose }) => {
  const [mode, setMode] = useState<"emoji" | "icons">("emoji");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [activeCat, setActiveCat] = useState<"recent" | EmojiCategoryId>(recent.length > 0 ? "recent" : EMOJI_CATEGORIES[0].id);
  const [tint, setTint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const byChar = useMemo(() => {
    const map = new Map<string, EmojiEntry>();
    for (const category of EMOJI_CATEGORIES) {
      for (const entry of category.emoji) map.set(entry.char, entry);
    }
    return map;
  }, []);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;
  // A query containing any non-ASCII character (a pasted emoji, or any other
  // glyph) becomes a selectable "custom" entry so arbitrary icons work too.
  const customEntry = mode === "emoji" && containsNonAscii(trimmedQuery) ? trimmedQuery : null;

  // Cheap enough to compute per render (≤450 entries) — no memo needed.
  const emojiCells: { char: string; label: string }[] = (() => {
    if (mode !== "emoji") return [];
    if (searching) {
      const list = searchEmoji(query).map((e) => ({ char: e.char, label: e.name }));
      if (customEntry && !list.some((c) => c.char === customEntry)) {
        list.unshift({ char: customEntry, label: customEntry });
      }
      return list;
    }
    if (activeCat === "recent") {
      return recent.map((char) => ({ char, label: byChar.get(char)?.name ?? char }));
    }
    const category = EMOJI_CATEGORIES.find((c) => c.id === activeCat) ?? EMOJI_CATEGORIES[0];
    return category.emoji.map((e) => ({ char: e.char, label: e.name }));
  })();

  const iconCells = mode === "icons" ? (searching ? searchLucideIcons(query) : LUCIDE_ICONS) : [];

  const handleSelectEmoji = (char: string) => {
    setRecent(saveRecent(char, recent));
    onSelect(char);
  };

  // Clamp so the popover stays fully inside the viewport.
  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MAX_HEIGHT - 8));

  const tabs: { id: "recent" | EmojiCategoryId; icon: string; label: string }[] = [
    ...(recent.length > 0 ? [{ id: "recent" as const, icon: "🕘", label: labels.recent }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: CATEGORY_ICONS[c.id], label: labels.categories[c.id] })),
  ];
  const activeTabLabel =
    activeCat === "recent" ? labels.recent : labels.categories[activeCat as EmojiCategoryId];

  const emptyState = (
    <div style={{ padding: "16px 0", textAlign: "center", fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
      {labels.noResults}
    </div>
  );

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose} />
      <div
        role="dialog"
        style={{
          position: "fixed",
          left,
          top,
          width: WIDTH,
          maxHeight: MAX_HEIGHT,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-2)",
          padding: "8px",
          boxSizing: "border-box",
          zIndex: "var(--z-menu)",
        }}
      >
        {/* Mode switch: Emoji vs. icon set (Notion-like). Hidden for the
            text-insertion picker (emojiOnly), where an icon set is meaningless. */}
        {!emojiOnly && (
          <div style={{ display: "flex", gap: "4px", marginBottom: "6px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "2px" }}>
            {([
              { id: "emoji" as const, label: labels.modeEmoji },
              { id: "icons" as const, label: labels.modeIcons },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setMode(m.id); setQuery(""); }}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  fontSize: "var(--text-sm)",
                  fontWeight: mode === m.id ? 600 : 400,
                  background: mode === m.id ? "var(--bg-primary)" : "transparent",
                  color: mode === m.id ? "var(--accent-color)" : "var(--text-muted)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  boxShadow: mode === m.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={labels.searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customEntry) {
              e.preventDefault();
              handleSelectEmoji(customEntry);
            }
          }}
          className="pv-field pv-field--compact"
        />

        {mode === "emoji" && !searching && (
          <>
            {/* Category tab bar — visually distinct from the grid (muted,
                grayscaled glyphs, accent underline) so it reads as navigation,
                not as selectable emoji. */}
            <div
              role="tablist"
              style={{
                display: "flex",
                gap: "2px",
                margin: "6px 0 0",
                background: "var(--bg-secondary)",
                borderRadius: "var(--radius-sm)",
                padding: "2px 2px 0",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {tabs.map((tab) => {
                const active = tab.id === activeCat;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-tip={tab.label}
                    aria-label={tab.label}
                    onClick={() => setActiveCat(tab.id)}
                    style={{
                      flex: 1,
                      padding: "5px 0 4px",
                      fontSize: "var(--text-md)",
                      lineHeight: 1,
                      background: active ? "var(--bg-primary)" : "transparent",
                      border: "none",
                      borderBottom: active ? "2px solid var(--accent-color)" : "2px solid transparent",
                      borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                      cursor: "pointer",
                      filter: active ? "none" : "grayscale(1)",
                      opacity: active ? 1 : 0.55,
                    }}
                  >
                    {tab.icon}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "5px 2px 3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {activeTabLabel}
            </div>
          </>
        )}

        {mode === "icons" && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "6px 0 4px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginRight: "2px" }}>{labels.tint}</span>
            <button
              type="button"
              data-tip={labels.tintDefault}
              aria-label={labels.tintDefault}
              onClick={() => setTint(null)}
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                border: tint === null ? "2px solid var(--accent-color)" : "1px solid var(--border-color)",
                background: "var(--bg-secondary)",
                color: "var(--text-main)",
                cursor: "pointer",
                fontSize: "var(--text-xs)",
                lineHeight: 1,
                padding: 0,
              }}
            >
              A
            </button>
            {ICON_TINTS.map((color) => (
              <button
                key={color}
                type="button"
                data-tip={color}
                aria-label={color}
                onClick={() => setTint(color)}
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  border: tint === color ? "2px solid var(--accent-color)" : "1px solid var(--border-color)",
                  background: color,
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
            <input
              type="color"
              value={tint && /^#[0-9a-fA-F]{6}$/.test(tint) ? tint : "#2f6f6f"}
              onChange={(e) => setTint(e.target.value)}
              aria-label={labels.tint}
              style={{ width: "24px", height: "20px", padding: 0, border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", background: "transparent", cursor: "pointer" }}
            />
          </div>
        )}

        {mode === "emoji" ? (
          searching && emojiCells.length === 0 ? (
            emptyState
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(8, 1fr)",
                gap: "2px",
                alignContent: "start",
                marginTop: searching ? "6px" : 0,
              }}
            >
              {emojiCells.map((cell) => (
                <button
                  key={cell.char}
                  type="button"
                  aria-label={cell.label}
                  data-tip={cell.label}
                  onClick={() => handleSelectEmoji(cell.char)}
                  className="pv-rowhover"
                  style={gridButtonStyle}
                >
                  {cell.char}
                </button>
              ))}
            </div>
          )
        ) : iconCells.length === 0 ? (
          emptyState
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: "2px",
              alignContent: "start",
              marginTop: "2px",
            }}
          >
            {iconCells.map((entry) => (
              <button
                key={entry.name}
                type="button"
                aria-label={entry.name}
                data-tip={entry.name}
                onClick={() => onSelectIcon(entry.name, tint)}
                className="pv-rowhover"
                style={{ ...gridButtonStyle, color: tint ?? "var(--text-main)" }}
              >
                <DocIcon icon={`lucide:${entry.name}`} color={tint ?? undefined} size={ICON.head} />
              </button>
            ))}
          </div>
        )}

        {showRemove && onRemove && (
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border-color)", marginTop: "6px", paddingTop: "6px" }}>
            <button
              type="button"
              onClick={onRemove}
              className="pv-btn pv-btn--secondary pv-btn--sm"
            >
              {labels.remove}
            </button>
          </div>
        )}
      </div>
    </>
  );
};
