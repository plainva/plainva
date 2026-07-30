import { useMemo, useState } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { useTranslation } from "react-i18next";
import {
  ACCENT_PALETTE,
  DocIcon,
  docIconValue,
  EMOJI_CATEGORIES,
  LUCIDE_CATEGORY_TABS,
  LUCIDE_ICONS,
  RECENT_EMOJI_KEY,
  RECENT_ICON_KEY,
  loadRecentPicks,
  lucideIconsByCategory,
  saveRecentPick,
  searchEmoji,
  searchLucideIcons,
} from "@plainva/ui";
import type { EmojiCategoryId, LucideIconCategory } from "@plainva/ui";
import { Trash2 } from "lucide-react";

/** Representative tab glyph per emoji category (same set as the desktop). */
const EMOJI_TAB_GLYPH: Record<EmojiCategoryId, string> = {
  smileys: "😀",
  people: "👋",
  animals: "🐻",
  food: "🍔",
  activities: "⚽",
  travel: "🚗",
  objects: "💡",
  symbols: "❤️",
};

/**
 * Emoji sheet (M3E package C3): serves the /emoji slash command (insert at the
 * caret) AND the document-icon pick (header widget + /icon) — the shared
 * curated catalog from @plainva/ui, filtered by name/keyword.
 *
 * Findings round P4.2: the phone now offers what the desktop offers — recents in
 * BOTH modes, categories in both modes, and a colour for an icon pick. Before,
 * the icon mode was a flat alphabetical list of every name and a picked icon
 * could not carry a tint at all, so the same choice gave a different result
 * depending on which device you made it on.
 */
export function EmojiPickSheet({
  title,
  showRemove,
  onPick,
  onRemove,
  onClose,
}: {
  title: string;
  showRemove?: boolean;
  /** `color` is only ever set for an icon pick (emoji carry their own colour). */
  onPick: (char: string, color?: string | null) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"emoji" | "icons">("emoji");
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => loadRecentPicks(RECENT_EMOJI_KEY));
  const [recentIcons, setRecentIcons] = useState<string[]>(() => loadRecentPicks(RECENT_ICON_KEY));
  const [emojiCat, setEmojiCat] = useState<"recent" | EmojiCategoryId>(
    loadRecentPicks(RECENT_EMOJI_KEY).length > 0 ? "recent" : EMOJI_CATEGORIES[0].id,
  );
  const [iconCat, setIconCat] = useState<"recent" | LucideIconCategory>(
    loadRecentPicks(RECENT_ICON_KEY).length > 0 ? "recent" : LUCIDE_CATEGORY_TABS[0].id,
  );
  const [tint, setTint] = useState<string | null>(null);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const iconMode = mode === "icons" && showRemove;

  const icons = useMemo(() => {
    if (searching) return searchLucideIcons(trimmed);
    if (iconCat === "recent") {
      // A remembered name a later version no longer ships is simply dropped.
      return recentIcons.flatMap((name) => LUCIDE_ICONS.filter((e) => e.name === name));
    }
    return lucideIconsByCategory(iconCat);
  }, [searching, trimmed, iconCat, recentIcons]);

  const emoji = useMemo(() => {
    if (searching) return searchEmoji(trimmed).map((e) => ({ char: e.char, name: e.name }));
    if (emojiCat === "recent") return recentEmoji.map((char) => ({ char, name: char }));
    const category = EMOJI_CATEGORIES.find((c) => c.id === emojiCat) ?? EMOJI_CATEGORIES[0];
    return category.emoji.map((e) => ({ char: e.char, name: e.name }));
  }, [searching, trimmed, emojiCat, recentEmoji]);

  const pickEmoji = (char: string) => {
    setRecentEmoji(saveRecentPick(RECENT_EMOJI_KEY, char, recentEmoji));
    onPick(char);
  };
  const pickIcon = (name: string) => {
    setRecentIcons(saveRecentPick(RECENT_ICON_KEY, name, recentIcons));
    onPick(docIconValue(name), tint);
  };

  const sectionLabel = iconMode
    ? iconCat === "recent"
      ? t("emojiPicker.recent")
      : t(`emojiPicker.iconCategories.${iconCat}`)
    : emojiCat === "recent"
      ? t("emojiPicker.recent")
      : t(
          `emojiPicker.cat${emojiCat.charAt(0).toUpperCase()}${emojiCat.slice(1)}` as
            | "emojiPicker.catSmileys",
        );

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {showRemove && (
          <div className="m-seg m-seg--sheet">
            {(
              [
                ["emoji", t("emojiPicker.modeEmoji")],
                ["icons", t("emojiPicker.modeIcons")],
              ] as Array<["emoji" | "icons", string]>
            ).map(([id, label]) => (
              <button
                className={mode === id ? "m-seg-item is-on" : "m-seg-item"}
                key={id}
                onClick={() => {
                  setMode(id);
                  setQuery("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <input
          className="m-searchfield"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("emojiPicker.search")}
          value={query}
        />

        {/* The colour of an icon pick — the same palette the desktop offers, so
            the same choice gives the same file on both devices. */}
        {iconMode && (
          <>
            <p className="m-sectionlabel">{t("emojiPicker.tint")}</p>
            <div className="m-swatches">
              <button
                aria-label={t("emojiPicker.tintDefault")}
                aria-pressed={tint === null}
                className={tint === null ? "m-swatch m-swatch--default is-on" : "m-swatch m-swatch--default"}
                onClick={() => setTint(null)}
              >
                A
              </button>
              {ACCENT_PALETTE.map((color) => (
                <button
                  aria-label={color}
                  aria-pressed={tint === color}
                  className={tint === color ? "m-swatch is-on" : "m-swatch"}
                  key={color}
                  onClick={() => setTint(color)}
                  style={{ background: color }}
                />
              ))}
            </div>
          </>
        )}

        {/* Category tabs, in both modes (they existed in neither before). */}
        {!searching && (
          <div className="m-cattabs" role="tablist">
            {iconMode ? (
              <>
                {recentIcons.length > 0 && (
                  <button
                    aria-label={t("emojiPicker.recent")}
                    aria-selected={iconCat === "recent"}
                    className={iconCat === "recent" ? "m-cattab is-on" : "m-cattab"}
                    onClick={() => setIconCat("recent")}
                    role="tab"
                  >
                    🕘
                  </button>
                )}
                {LUCIDE_CATEGORY_TABS.map((tab) => (
                  <button
                    aria-label={t(tab.labelKey)}
                    aria-selected={iconCat === tab.id}
                    className={iconCat === tab.id ? "m-cattab is-on" : "m-cattab"}
                    key={tab.id}
                    onClick={() => setIconCat(tab.id)}
                    role="tab"
                  >
                    <DocIcon icon={docIconValue(tab.glyph)} size={18} />
                  </button>
                ))}
              </>
            ) : (
              <>
                {recentEmoji.length > 0 && (
                  <button
                    aria-label={t("emojiPicker.recent")}
                    aria-selected={emojiCat === "recent"}
                    className={emojiCat === "recent" ? "m-cattab is-on" : "m-cattab"}
                    onClick={() => setEmojiCat("recent")}
                    role="tab"
                  >
                    🕘
                  </button>
                )}
                {EMOJI_CATEGORIES.map((c) => (
                  <button
                    aria-selected={emojiCat === c.id}
                    className={emojiCat === c.id ? "m-cattab is-on" : "m-cattab"}
                    key={c.id}
                    onClick={() => setEmojiCat(c.id)}
                    role="tab"
                  >
                    {EMOJI_TAB_GLYPH[c.id]}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        {!searching && <p className="m-sectionlabel">{sectionLabel}</p>}

        {iconMode ? (
          icons.length === 0 ? (
            <p className="m-hint m-hint--inset">{t("emojiPicker.noResults")}</p>
          ) : (
            <div className="m-emojigrid m-emojigrid--icons">
              {icons.map((entry) => (
                <button aria-label={entry.name} key={entry.name} onClick={() => pickIcon(entry.name)}>
                  <DocIcon color={tint ?? undefined} icon={docIconValue(entry.name)} size={22} />
                </button>
              ))}
            </div>
          )
        ) : emoji.length === 0 ? (
          <p className="m-hint m-hint--inset">{t("emojiPicker.noResults")}</p>
        ) : (
          <div className="m-emojigrid">
            {emoji.map((e) => (
              <button aria-label={e.name} key={e.char + e.name} onClick={() => pickEmoji(e.char)}>
                {e.char}
              </button>
            ))}
          </div>
        )}

        {showRemove && onRemove && (
          <button className="m-row m-danger" onClick={onRemove}>
            <Trash2 size={18} style={{ flexShrink: 0 }} />
            <span>{t("emojiPicker.remove")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
