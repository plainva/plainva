import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EMOJI_CATEGORIES } from "@plainva/ui";
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
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{title}</p>
        <input
          className="m-searchfield"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("emojiPicker.search")}
          value={query}
        />
        {showRemove && onRemove && (
          <button className="m-row m-danger" onClick={onRemove}>
            <Trash2 size={18} style={{ flexShrink: 0 }} />
            <span>{t("emojiPicker.remove")}</span>
          </button>
        )}
        {emoji.length === 0 ? (
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
