import React, { useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_CATEGORIES, ICON, searchEmoji } from "@plainva/ui";
import type { EmojiCategoryId, EmojiEntry } from "@plainva/ui";
import { searchLucideIcons, LUCIDE_ICONS, lucideIconsByCategory } from "@plainva/ui";
import type { LucideIconCategory } from "@plainva/ui";
import {
  LUCIDE_CATEGORY_TABS,
  RECENT_EMOJI_KEY,
  RECENT_ICON_KEY,
  loadRecentPicks,
  saveRecentPick,
} from "@plainva/ui";
import { DocIcon, SearchField, Segmented } from "@plainva/ui";
import { ACCENT_PALETTE } from "./palette";

export interface EmojiPickerLabels {
  searchPlaceholder: string;
  clearSearch: string;
  recent: string;
  remove: string;
  noResults: string;
  categories: Record<EmojiCategoryId, string>;
  iconCategories: Record<LucideIconCategory, string>;
  modeEmoji: string;
  modeIcons: string;
  tint: string;
  tintDefault: string;
  tintCustom: string;
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

const WIDTH = 380;
const MAX_HEIGHT = 460;

// Representative tab glyph per emoji category (the accessible labels come from props).
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

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  padding: "6px 2px 3px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: "2px",
  margin: "6px 0 0",
  background: "var(--bg-secondary)",
  borderRadius: "var(--radius-sm)",
  padding: "2px 2px 0",
  borderBottom: "1px solid var(--border-color)",
};

function tabStyle(active: boolean, grayscale: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "5px 0 4px",
    fontSize: "var(--text-md)",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? "var(--bg-primary)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--accent-color)" : "2px solid transparent",
    borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
    cursor: "pointer",
    color: "var(--text-main)",
    filter: active || !grayscale ? "none" : "grayscale(1)",
    opacity: active ? 1 : 0.55,
  };
}

/**
 * The document-icon / emoji picker. Both modes are now the SAME surface (report
 * 2026-07-29, F10-F13): one head zone (mode switch + search in the normal field
 * metric), recents in both modes, categories in both modes, and the colour row in
 * the grammar of the shared header-colour picker instead of a hand-built circle
 * strip with a bare system field.
 */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({ x, y, labels, showRemove, emojiOnly, onSelect, onSelectIcon, onRemove, onClose }) => {
  const [mode, setMode] = useState<"emoji" | "icons">("emoji");
  const [query, setQuery] = useState("");
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => loadRecentPicks(RECENT_EMOJI_KEY));
  const [recentIcons, setRecentIcons] = useState<string[]>(() => loadRecentPicks(RECENT_ICON_KEY));
  const [activeCat, setActiveCat] = useState<"recent" | EmojiCategoryId>(
    loadRecentPicks(RECENT_EMOJI_KEY).length > 0 ? "recent" : EMOJI_CATEGORIES[0].id,
  );
  const [activeIconCat, setActiveIconCat] = useState<"recent" | LucideIconCategory>(
    loadRecentPicks(RECENT_ICON_KEY).length > 0 ? "recent" : LUCIDE_CATEGORY_TABS[0].id,
  );
  const [tint, setTint] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
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
      return recentEmoji.map((char) => ({ char, label: byChar.get(char)?.name ?? char }));
    }
    const category = EMOJI_CATEGORIES.find((c) => c.id === activeCat) ?? EMOJI_CATEGORIES[0];
    return category.emoji.map((e) => ({ char: e.char, label: e.name }));
  })();

  const iconCells = (() => {
    if (mode !== "icons") return [];
    if (searching) return searchLucideIcons(query);
    if (activeIconCat === "recent") {
      // A recent name that a later version no longer ships is simply dropped.
      return recentIcons.flatMap((name) => LUCIDE_ICONS.filter((e) => e.name === name));
    }
    return lucideIconsByCategory(activeIconCat);
  })();

  const handleSelectEmoji = (char: string) => {
    setRecentEmoji(saveRecentPick(RECENT_EMOJI_KEY, char, recentEmoji));
    onSelect(char);
  };

  const handleSelectIcon = (name: string) => {
    setRecentIcons(saveRecentPick(RECENT_ICON_KEY, name, recentIcons));
    onSelectIcon(name, tint);
  };

  // Clamp so the popover stays fully inside the viewport.
  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MAX_HEIGHT - 8));

  const emojiTabs: { id: "recent" | EmojiCategoryId; icon: string; label: string }[] = [
    ...(recentEmoji.length > 0 ? [{ id: "recent" as const, icon: "🕘", label: labels.recent }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: CATEGORY_ICONS[c.id], label: labels.categories[c.id] })),
  ];
  const activeSectionLabel =
    mode === "emoji"
      ? activeCat === "recent"
        ? labels.recent
        : labels.categories[activeCat as EmojiCategoryId]
      : activeIconCat === "recent"
        ? labels.recent
        : labels.iconCategories[activeIconCat as LucideIconCategory];

  const emptyState = (
    <div style={{ padding: "16px 0", textAlign: "center", fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
      {labels.noResults}
    </div>
  );

  const grid = (children: React.ReactNode) => (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: "repeat(9, 1fr)",
        gap: "2px",
        alignContent: "start",
      }}
    >
      {children}
    </div>
  );

  return (
    <>
      {/* Invisible full-viewport click-catcher (dismiss on outside click). No
          shared class provides a bare, non-dimmed fixed overlay without
          touching styles/ui.css — position:fixed stays inline here. */}
      <div className="pv-click-catch" style={{ zIndex: "var(--z-menu)" }} onClick={onClose} />
      <div
        role="dialog"
        data-testid="emoji-picker"
        className="pv-popover pv-popover--fixed"
        style={{
          left,
          top,
          width: WIDTH,
          maxWidth: WIDTH,
          maxHeight: MAX_HEIGHT,
          display: "flex",
          flexDirection: "column",
          padding: "8px",
          boxSizing: "border-box",
          visibility: "visible",
        }}
      >
        {/* Head zone, identical in both modes: mode switch, then the search
            field in the NORMAL field metric (it used to be --compact in one mode
            and not the other, which is what made the two look unrelated). */}
        {!emojiOnly && (
          <div style={{ marginBottom: "6px" }}>
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next);
                setQuery("");
              }}
              options={[
                { value: "emoji" as const, label: labels.modeEmoji, testId: "picker-mode-emoji" },
                { value: "icons" as const, label: labels.modeIcons, testId: "picker-mode-icons" },
              ]}
              ariaLabel={`${labels.modeEmoji} / ${labels.modeIcons}`}
            />
          </div>
        )}

        <SearchField
          ref={inputRef}
          form
          value={query}
          onValueChange={setQuery}
          clearLabel={labels.clearSearch}
          placeholder={labels.searchPlaceholder}
          data-testid="picker-search"
          onKeyDown={(e) => {
            if (e.key === "Enter" && customEntry) {
              e.preventDefault();
              handleSelectEmoji(customEntry);
            }
          }}
        />

        {/* The colour row (icon mode): the swatch grammar of the shared
            header-colour picker — rectangles, "A" for the default, and a
            "custom colour" action instead of a naked system field. */}
        {mode === "icons" && (
          <>
            <div style={sectionLabelStyle}>{labels.tint}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
              <button
                type="button"
                data-tip={labels.tintDefault}
                aria-label={labels.tintDefault}
                aria-pressed={tint === null}
                onClick={() => setTint(null)}
                style={{
                  width: "26px",
                  height: "20px",
                  borderRadius: "var(--radius-sm)",
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
                  aria-pressed={tint === color}
                  onClick={() => setTint(color)}
                  style={{
                    width: "26px",
                    height: "20px",
                    borderRadius: "var(--radius-sm)",
                    border: tint === color ? "2px solid var(--accent-color)" : "1px solid var(--border-color)",
                    background: color,
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
              {customOpen ? (
                <input
                  type="color"
                  value={tint && /^#[0-9a-fA-F]{6}$/.test(tint) ? tint : "#2f6f6f"}
                  onChange={(e) => setTint(e.target.value)}
                  aria-label={labels.tintCustom}
                  style={{ width: "34px", height: "20px", padding: 0, border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}
                />
              ) : (
                <button
                  type="button"
                  className="pv-chip"
                  onClick={() => setCustomOpen(true)}
                  data-testid="picker-tint-custom"
                >
                  {labels.tintCustom}
                </button>
              )}
            </div>
          </>
        )}

        {/* Category tabs — in BOTH modes now. Muted/grayscaled so they read as
            navigation, not as selectable cells. Hidden while searching, where
            the query is the navigation. */}
        {!searching && mode === "emoji" && (
          <div role="tablist" style={tabBarStyle}>
            {emojiTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeCat}
                data-tip={tab.label}
                aria-label={tab.label}
                onClick={() => setActiveCat(tab.id)}
                style={tabStyle(tab.id === activeCat, true)}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        )}
        {!searching && mode === "icons" && (
          <div role="tablist" style={tabBarStyle} data-testid="picker-icon-tabs">
            {recentIcons.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeIconCat === "recent"}
                data-tip={labels.recent}
                aria-label={labels.recent}
                onClick={() => setActiveIconCat("recent")}
                style={tabStyle(activeIconCat === "recent", true)}
              >
                🕘
              </button>
            )}
            {LUCIDE_CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeIconCat}
                data-tip={labels.iconCategories[tab.id]}
                aria-label={labels.iconCategories[tab.id]}
                onClick={() => setActiveIconCat(tab.id)}
                style={tabStyle(tab.id === activeIconCat, false)}
              >
                <DocIcon icon={`lucide:${tab.glyph}`} size={ICON.ui} />
              </button>
            ))}
          </div>
        )}
        {!searching && <div style={sectionLabelStyle}>{activeSectionLabel}</div>}

        {mode === "emoji"
          ? emojiCells.length === 0
            ? emptyState
            : grid(
                emojiCells.map((cell) => (
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
                )),
              )
          : iconCells.length === 0
            ? emptyState
            : grid(
                iconCells.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    aria-label={entry.name}
                    data-tip={entry.name}
                    onClick={() => handleSelectIcon(entry.name)}
                    className="pv-rowhover"
                    style={{ ...gridButtonStyle, color: tint ?? "var(--text-main)" }}
                  >
                    <DocIcon icon={`lucide:${entry.name}`} color={tint ?? undefined} size={ICON.head} />
                  </button>
                )),
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
