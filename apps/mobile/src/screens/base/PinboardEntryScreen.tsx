import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button, Chip, errorText, ICON, IconButton, TextInput, toast, type PinboardEntryChip } from "@plainva/ui";
import { AppBar } from "../../components/AppBar";
import { EditorHost } from "../../EditorHost";
import { discardMobilePinboardEntry, finalizeMobilePinboardEntry } from "../../services/baseOps";
import { mConfirm } from "../../services/mobileDialogs";
import { registerSheet } from "../../services/sheetStack";
import { vaultOps, type MobileVault } from "../../services/vaultService";
import { parsePinboardEntryRef } from "./pinboardEntryRef";

/**
 * "New entry" on the phone (plan Befunde 2026-09-24, E17): a PAGE of its own,
 * not a sheet — the keyboard and the formatting bar need the room. A title
 * field and the same editor every note has (`EditorHost`, writing, with the
 * docked formatting bar), writing into the draft the pinboard created in its
 * folder when the FAB was tapped. The result is the same file the desktop's
 * "New entry" window makes (E15):
 *
 *  - **Done** keeps it — the title becomes `# Title` and the file name, through
 *    the link-safe rename (a move on every other device);
 *  - every way back (the back arrow, Android's back key) keeps whatever was
 *    typed and silently takes back a draft nobody wrote into;
 *  - **Discard** asks when there is content, then deletes the draft.
 *
 * The title comes first; the text takes over on Enter or a tap. Until then
 * the editor stays read-only, or its own focus would take the keyboard away
 * from the title the moment the page opens.
 */
export function PinboardEntryScreen({ vault, entry, onBack }: { vault: MobileVault; entry: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [ref] = useState(() => parsePinboardEntryRef(entry));
  const draft = ref?.draft ?? null;
  const [doc, setDoc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [removedChips, setRemovedChips] = useState<PinboardEntryChip[]>([]);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const endedRef = useRef(false);
  // Set in the same tick as the tap: a second tap on Done, or the back key
  // while Done is still writing, must not start a second end of the entry.
  const endingRef = useRef(false);
  // An end that finishes after the page was already left (the back key while
  // Done was still writing) must not go back a second time — that would pop
  // the database underneath.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const leave = () => { if (mountedRef.current) onBack(); };
  const latest = useRef({ title, removedChips });
  useEffect(() => { latest.current = { title, removedChips }; }, [title, removedChips]);

  // Load the draft. Gone means the entry already ended (the page came back
  // from the stack after its draft was saved or taken back): go back.
  useEffect(() => {
    if (!draft) {
      if (!endedRef.current) {
        endedRef.current = true;
        onBack();
      }
      return;
    }
    let alive = true;
    void vaultOps
      .readEditor(vault, draft.path)
      .then((text) => { if (alive) setDoc(text); })
      .catch(() => {
        if (!alive) return;
        endedRef.current = true;
        onBack();
      });
    return () => { alive = false; };
    // The page is keyed on its entry; `onBack` is the route's stable pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, draft]);

  const end = async (intent: "save" | "close") => {
    if (!draft || endedRef.current || endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      const result = await finalizeMobilePinboardEntry(vault, draft, { title, removedChips, intent });
      endedRef.current = true;
      if (result.renameFailed) toast.warning(t("pinboard.entryRenameFailed"));
      leave();
    } catch (e) {
      // Nothing was thrown away; the page stays so the text is still here.
      toast.error(t("pinboard.entrySaveFailed", { message: errorText(e) }));
    } finally {
      endingRef.current = false;
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!draft || endedRef.current || endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      const outcome = await discardMobilePinboardEntry(vault, draft, {
        title,
        confirm: () =>
          mConfirm({
            title: t("pinboard.entryDiscardTitle"),
            message: t("pinboard.entryDiscardMessage"),
            danger: true,
            confirmLabel: t("pinboard.entryDiscard"),
          }),
      });
      if (outcome === "removed") {
        endedRef.current = true;
        leave();
      }
    } catch (e) {
      toast.error(t("pinboard.entrySaveFailed", { message: errorText(e) }));
    } finally {
      endingRef.current = false;
      setBusy(false);
    }
  };

  // Android's back key closes the page the way the back arrow does (E15):
  // registered like a sheet, so a sheet opened ON the page closes first.
  const endRef = useRef(end);
  useEffect(() => { endRef.current = end; });
  useEffect(() => registerSheet(() => { void endRef.current("close"); }), []);

  // Left by any other route (the page unmounted without ending): end it the
  // way closing does. Deferred and cancelled by a mount, because StrictMode
  // unmounts and remounts once, and that must not end a fresh entry.
  const unmountTimer = useRef<number | null>(null);
  useEffect(() => {
    if (unmountTimer.current !== null) {
      window.clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    return () => {
      unmountTimer.current = window.setTimeout(() => {
        unmountTimer.current = null;
        // An end already under way finishes on its own.
        if (!draft || endedRef.current || endingRef.current) return;
        endedRef.current = true;
        void finalizeMobilePinboardEntry(vault, draft, { ...latest.current, intent: "close" }).catch(() => {});
      }, 0);
    };
  }, [vault, draft]);

  if (!draft) return null;
  const visibleChips = draft.chips.filter((chip) => !removedChips.some((r) => r.id === chip.id));
  const chipLabel = (chip: PinboardEntryChip) =>
    chip.kind === "tag" ? `#${chip.value}` : chip.from === "label" ? chip.value : `${chip.key}: ${chip.value}`;

  return (
    <div className="m-page m-page--note" data-testid="pinboard-entry-page">
      <AppBar
        onBack={() => { void end("close"); }}
        title={t("pinboard.entryTitle")}
        subtitle={t("pinboard.entryLandsIn", { folder: draft.folder ? `${draft.folder}/` : "/" })}
        actions={<>
          <IconButton label={t("pinboard.entryDiscard")} disabled={busy} onClick={() => { void discard(); }} data-testid="pinboard-entry-discard">
            <Trash2 size={ICON.head} />
          </IconButton>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { void end("save"); }} data-testid="pinboard-entry-done">
            {t("mobile.doneEditing")}
          </Button>
        </>}
      />
      <TextInput
        className="pv-pinentry-title m-pinentry-title"
        data-testid="pinboard-entry-title"
        value={title}
        autoFocus
        enterKeyHint="next"
        placeholder={t("pinboard.entryTitlePlaceholder")}
        aria-label={t("pinboard.entryTitlePlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            setWriting(true);
          }
        }}
      />
      {visibleChips.length > 0 && (
        <div className="m-pinentry-chips" data-testid="pinboard-entry-meta">
          {visibleChips.map((chip) => (
            <Chip
              key={chip.id}
              size="sm"
              testId="pinboard-entry-chip"
              onRemove={() => setRemovedChips((prev) => [...prev, chip])}
              removeLabel={t("pinboard.entryRemoveChip", { value: chipLabel(chip) })}
            >
              {chipLabel(chip)}
            </Chip>
          ))}
        </div>
      )}
      {doc !== null && (
        // A tap into the text starts writing there; EditorHost then puts the
        // caret at the template's cursor or the end, never in the hidden
        // frontmatter.
        <div className="m-pinentry-editor" data-testid="pinboard-entry-editor" onPointerDownCapture={() => setWriting(true)}>
          <EditorHost editable={writing && !busy} initialDoc={doc} onOpenNote={() => {}} path={draft.path} vault={vault} />
        </div>
      )}
    </div>
  );
}
