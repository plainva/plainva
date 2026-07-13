import { useMemo, useState } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { DocIcon, docIconValue, EMOJI_CATEGORIES, LUCIDE_ICON_MAP } from "@plainva/ui";
import { Trash2 } from "lucide-react";

/**
 * Emoji sheet (M3E package C3): serves the /emoji slash command (insert at the
 * caret) AND the document-icon pick (header widget + /icon) — the shared
 * curated catalog from @plainva/ui, filtered by name/keyword.
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
  onPick: (char: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"emoji" | "icons">("emoji");
  const iconNames = useMemo(() => [...LUCIDE_ICON_MAP.keys()].sort(), []);
  const icons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return iconNames;
    return iconNames.filter((n) => n.includes(q));
  }, [iconNames, query]);

  const emoji = useMemo(() => {
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emoji);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) => e.char === q || e.name.includes(q) || e.keywords?.some((k) => k.includes(q)),
    );
  }, [query]);

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <input
          className="m-searchfield"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("emojiPicker.search")}
          value={query}
        />
        {showRemove && (
          <div className="m-seg m-seg--sheet">
            {(
              [
                ["emoji", t("emojiPicker.modeEmoji")],
                ["icons", t("emojiPicker.modeIcons")],
              ] as Array<["emoji" | "icons", string]>
            ).map(([id, label]) => (
              <button className={mode === id ? "m-seg-item is-on" : "m-seg-item"} key={id} onClick={() => setMode(id)}>
                {label}
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
        {mode === "icons" && showRemove ? (
          icons.length === 0 ? (
            <p className="m-hint m-hint--inset">{t("emojiPicker.noResults")}</p>
          ) : (
            <div className="m-emojigrid m-emojigrid--icons">
              {icons.map((name) => (
                <button aria-label={name} key={name} onClick={() => onPick(docIconValue(name))}>
                  <DocIcon icon={docIconValue(name)} size={22} />
                </button>
              ))}
            </div>
          )
        ) : emoji.length === 0 ? (
          <p className="m-hint m-hint--inset">{t("emojiPicker.noResults")}</p>
        ) : (
          <div className="m-emojigrid">
            {emoji.map((e) => (
              <button aria-label={e.name} key={e.char + e.name} onClick={() => onPick(e.char)}>
                {e.char}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
