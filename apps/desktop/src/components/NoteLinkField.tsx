import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Button, fuzzyFilter, ICON, SearchField, useFixedPopover, useOutsidePress } from "@plainva/ui";

/** More names than this are not listed at once: the field narrows them down. */
const SHOWN = 12;

/**
 * "Link a note" in a form that is not a note — the event editor (F2): a field
 * that lists the vault's notes by name, the relation picker's pattern
 * (input plus `pv-popover`). A pick hands the note's path to the form, which
 * writes the link; the field itself writes nothing.
 */
export function NoteLinkField({
  listNotes,
  onPick,
  testId,
}: {
  listNotes: () => Promise<{ path: string; title: string }[]>;
  onPick: (note: { path: string; title: string }) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<{ path: string; title: string }[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useOutsidePress(open, () => setOpen(false), wrapRef);
  const popRef = useFixedPopover(open, wrapRef);

  // The names are read once per opening, as the phone's note picker does.
  useEffect(() => {
    if (!open || notes !== null) return;
    let alive = true;
    void listNotes()
      .then((list) => { if (alive) setNotes(list); })
      .catch(() => { if (alive) setNotes([]); });
    return () => { alive = false; };
  }, [open, notes, listNotes]);

  const term = query.trim();
  const list = notes ?? [];
  const shown = term ? fuzzyFilter(term, list, (note) => [note.title, note.path], SHOWN).map((hit) => hit.item) : list.slice(0, SHOWN);
  const pick = (note: { path: string; title: string }) => {
    setQuery("");
    setOpen(false);
    onPick(note);
  };

  return (
    <div ref={wrapRef}>
      <SearchField
        value={query}
        onValueChange={(next) => { setQuery(next); setOpen(true); }}
        onEscapeWhenEmpty={() => setOpen(false)}
        clearLabel={t("sidebar.clearSearch")}
        placeholder={t("quickSwitcher.placeholder")}
        aria-label={t("noteLink.insert")}
        data-testid={testId}
        form
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (shown[0]) pick(shown[0]); }
        }}
      />
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed" data-testid={testId ? `${testId}-list` : undefined}>
          {notes !== null && shown.length === 0 && <div className="pv-popover-label">{t("quickSwitcher.noFilesFound")}</div>}
          {shown.map((note) => (
            <Button variant="ghost" key={note.path} type="button" className="pv-popover-row" data-tip={note.path} onMouseDown={(e) => { e.preventDefault(); pick(note); }}>
              <FileText size={ICON.ui} className="pv-popover-ic" /> <span className="pv-chip-text">{note.title || note.path}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
