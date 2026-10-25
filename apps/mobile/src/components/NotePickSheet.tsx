import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { fuzzyFilter, ICON, SearchField } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import type { MobileVault } from "../services/vaultService";

/** More names than this are not listed at once: the field narrows them down. */
const SHOWN = 40;

/**
 * A note of the vault, picked by its name (plan KI-Harness P9-3): the phone's
 * form of the desktop's quick switcher where the AI asks for a note — to pin
 * it to a conversation, or as an example of the writing style. One tap picks
 * and closes. The names are read once per open, as the search reads them: a
 * fuzzy match over a live query would ask the index on every keystroke.
 */
export function NotePickSheet({
  vault,
  title,
  hint,
  onPick,
  onClose,
}: {
  vault: MobileVault;
  title: string;
  /** One line under the title: what the note is picked for. */
  hint?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<{ path: string; title: string }[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let stale = false;
    const listed = vault.queryService ? vault.queryService.listNotes() : Promise.resolve([]);
    void listed
      .then((list) => {
        if (!stale) setNotes(list);
      })
      .catch(() => {
        if (!stale) setNotes([]);
      });
    return () => {
      stale = true;
    };
  }, [vault]);

  const shown = useMemo(() => {
    const list = notes ?? [];
    const term = query.trim();
    return term ? fuzzyFilter(term, list, (note) => [note.title, note.path], SHOWN).map((hit) => hit.item) : list.slice(0, SHOWN);
  }, [notes, query]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="note-pick-sheet">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {hint && <p className="m-hint">{hint}</p>}
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={t("quickSwitcher.placeholder")}
          aria-label={t("quickSwitcher.placeholder")}
          clearLabel={t("sidebar.clearSearch")}
          data-testid="note-pick-search"
        />
        {notes !== null && shown.length === 0 && <p className="m-hint">{t("quickSwitcher.noFilesFound")}</p>}
        {shown.map((note) => (
          <button
            type="button"
            className="m-row"
            key={note.path}
            data-testid="note-pick-row"
            onClick={() => {
              onClose();
              onPick(note.path);
            }}
          >
            <FileText size={ICON.head} />
            <span>{note.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
