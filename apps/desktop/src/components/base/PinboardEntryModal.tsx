import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { StickyNote } from "lucide-react";
import { EditorView } from "@codemirror/view";
import {
  Button,
  Chip,
  errorText,
  frontmatterEndOf,
  ICON,
  Modal,
  ShortcutHints,
  TextInput,
  discardPinboardEntry,
  finalizePinboardEntry,
  toast,
  type PinboardDraft,
  type PinboardEntryChip,
  type PinboardEntryFiles,
  type PinboardEntryResult,
} from "@plainva/ui";
import { createDocChannel } from "../../services/activeDocument";
import { appConfirm } from "../../services/appDialogs";
import { requestSaveFlush } from "../../services/saveFlush";
import { rememberSessionViewMode } from "../../services/viewModeDefault";
import { detectMac } from "../WindowControls";

// The full editor, loaded lazily — the same cycle break the peek uses:
// Editor -> NoteEmbedPlugin -> BaseViewer -> PinboardEntryModal -> Editor.
const LazyEditor = lazy(() => import("../Editor").then((m) => ({ default: m.Editor })));

/**
 * "New entry" on a pinboard (plan Befunde 2026-09-24, E14–E16).
 *
 * A title and the SAME editor every note has, in the live view — not a second
 * editor: completion, pasted images and the slash menu come along because it
 * is the editor. It writes into the draft file the viewer created in the
 * target folder when the window opened; the window only ends the entry:
 *
 *  - **Save** (and Ctrl/Cmd+Enter) keeps it — the title becomes `# Title` and
 *    the file name, through the link-safe rename;
 *  - closing (X, Escape) keeps whatever was typed and silently takes back a
 *    draft nobody wrote into — it never throws text away;
 *  - **Discard** asks when there is content, then puts the draft in the trash.
 *
 * Inside the modal Ctrl/Cmd+Enter saves; the editor's own binding for that
 * key (toggle a task line) yields to it here — the window's keys are the ones
 * written in its footer.
 *
 * Rendered through a portal: an embedded board lives inside a note's editor,
 * and a second editor nested in the first one's DOM would receive (and hand
 * on) the host's keystrokes.
 */
export function PinboardEntryModal({
  draft,
  files,
  vaultPath,
  onDone,
}: {
  draft: PinboardDraft;
  files: PinboardEntryFiles;
  vaultPath: string | null;
  /** The entry ended — kept at `path`, or removed. */
  onDone: (result: PinboardEntryResult) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [removedChips, setRemovedChips] = useState<PinboardEntryChip[]>([]);
  const [busy, setBusy] = useState(false);
  // The editor opens in the live view whatever the default view mode says,
  // decided before it mounts (its initial state reads this).
  useState(() => rememberSessionViewMode(draft.path, "live"));
  const channel = useMemo(() => createDocChannel(), []);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // What the unmount path needs, kept current without re-running effects.
  const endedRef = useRef(false);
  // Set in the same tick as the click or key: a second Save (or Escape while
  // Save is still writing) must not start a second end of the entry.
  const endingRef = useRef(false);
  const latest = useRef({ title, removedChips });
  useEffect(() => { latest.current = { title, removedChips }; }, [title, removedChips]);

  const folderLabel = draft.folder ? `${draft.folder}/` : "/";
  const visibleChips = draft.chips.filter((chip) => !removedChips.some((r) => r.id === chip.id));
  const liveText = () => {
    const doc = channel.get();
    return doc.path === draft.path ? doc.content : undefined;
  };

  /** Lands the editor's pending text; false when that write failed. */
  const flush = async (): Promise<boolean> => {
    try {
      await requestSaveFlush(draft.path, vaultPath ?? undefined);
      return true;
    } catch (e) {
      // The text is still in the editor and nothing was touched on disk: the
      // window stays open, so nothing can be lost by ending it now.
      toast.error(t("pinboard.entrySaveFailed", { message: errorText(e) }));
      return false;
    }
  };

  const end = async (intent: "save" | "close") => {
    if (endedRef.current || endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await finalizePinboardEntry(files, { draft, title, removedChips, intent, live: liveText() });
      endedRef.current = true;
      onDone(result);
    } catch (e) {
      toast.error(t("pinboard.entrySaveFailed", { message: errorText(e) }));
    } finally {
      endingRef.current = false;
      setBusy(false);
    }
  };

  const discard = async () => {
    if (endedRef.current || endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const outcome = await discardPinboardEntry(files, {
        draft,
        title,
        live: liveText(),
        confirm: () =>
          appConfirm({
            title: t("pinboard.entryDiscardTitle"),
            message: t("pinboard.entryDiscardMessage"),
            kind: "danger",
            confirmLabel: t("pinboard.entryDiscard"),
          }),
      });
      if (outcome === "removed") {
        endedRef.current = true;
        onDone({ outcome: "removed", path: null });
      }
    } catch (e) {
      toast.error(t("pinboard.entrySaveFailed", { message: errorText(e) }));
    } finally {
      endingRef.current = false;
      setBusy(false);
    }
  };

  // Ctrl/Cmd+Enter saves wherever the focus is inside the window — in the
  // capture phase, before the editor's own binding sees the key.
  const saveRef = useRef(end);
  useEffect(() => { saveRef.current = end; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.isComposing) return;
      const panel = editorHostRef.current?.closest(".pv-modal");
      if (!panel || !(e.target instanceof Node) || !panel.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      void saveRef.current("save");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // The viewer went away while the window was open (tab closed, view
  // switched): end the entry the way closing does — keep what was typed,
  // take back an empty draft. Deferred by a tick and cancelled by a mount:
  // StrictMode unmounts and remounts every component once, and that must not
  // end an entry that has only just opened.
  const unmountTimer = useRef<number | null>(null);
  const endContext = useRef({ files, vaultPath });
  useEffect(() => { endContext.current = { files, vaultPath }; }, [files, vaultPath]);
  useEffect(() => {
    if (unmountTimer.current !== null) {
      window.clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    return () => {
      unmountTimer.current = window.setTimeout(() => {
        unmountTimer.current = null;
        // An end already under way finishes on its own.
        if (endedRef.current || endingRef.current) return;
        endedRef.current = true;
        const { files: ends, vaultPath: vault } = endContext.current;
        void (async () => {
          try {
            await requestSaveFlush(draft.path, vault ?? undefined);
          } catch {
            return; // the text could not land; leave the file exactly as it is
          }
          await finalizePinboardEntry(ends, { draft, title: latest.current.title, removedChips: latest.current.removedChips, intent: "close" }).catch(() => {});
        })();
      }, 0);
    };
  }, [draft]);

  const editorView = () => {
    const content = editorHostRef.current?.querySelector<HTMLElement>(".cm-content");
    return content ? EditorView.findFromDOM(content) : null;
  };
  /**
   * The caret belongs in the text, never in the hidden frontmatter: an
   * untouched editor holds it at 0, where the live view refuses every
   * keystroke. It goes to the template's `{{cursor}}`, else to the end.
   */
  const placeBodyCaret = () => {
    const view = editorView();
    if (!view) return;
    const doc = view.state.doc.toString();
    const bodyStart = frontmatterEndOf(doc);
    const sel = view.state.selection.main;
    const placed = sel.head > 0 || !sel.empty;
    if (placed && sel.head >= bodyStart) return;
    const at = draft.caret !== null && draft.caret >= bodyStart && draft.caret <= doc.length ? draft.caret : doc.length;
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  };
  // Enter in the title moves on to the text. The editor is loaded lazily, and
  // an Enter that comes before it is there used to be lost: the focus stayed
  // in the title. It is kept now and carried out once the editor has mounted
  // — unless the person has gone on typing the title in the meantime.
  const wantsTextRef = useRef(false);
  const focusEditor = () => {
    const view = editorView();
    if (!view) {
      wantsTextRef.current = true;
      return;
    }
    wantsTextRef.current = false;
    placeBodyCaret();
    view.focus();
  };
  useEffect(() => {
    const host = editorHostRef.current;
    if (!host || editorView()) return;
    const observer = new MutationObserver(() => {
      const view = editorView();
      if (!view) return;
      observer.disconnect();
      if (!wantsTextRef.current) return;
      wantsTextRef.current = false;
      if (document.activeElement !== titleRef.current) return;
      placeBodyCaret();
      view.focus();
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
    // Mount only: it waits for the one editor this window holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mod = detectMac() ? "⌘" : "Ctrl";
  const chipLabel = (chip: PinboardEntryChip) =>
    chip.kind === "tag" ? `#${chip.value}` : chip.from === "label" ? chip.value : `${chip.key}: ${chip.value}`;

  return createPortal(
    <Modal
      onClose={() => { void end("close"); }}
      title={t("pinboard.entryTitle")}
      icon={<StickyNote size={ICON.head} />}
      headerNote={t("pinboard.entryLandsIn", { folder: folderLabel })}
      size="lg"
      bodyClassName="pv-pinentry"
      initialFocusRef={titleRef}
      testId="pinboard-entry"
      footer={
        <>
          <ShortcutHints
            className="pv-pinentry-hints"
            hints={[
              { keys: [mod, "Enter"], label: t("pinboard.entryHintSave") },
              { keys: ["Esc"], label: t("pinboard.entryHintClose") },
            ]}
          />
          <Button variant="ghost" disabled={busy} onClick={() => { void discard(); }} data-testid="pinboard-entry-discard">
            {t("pinboard.entryDiscard")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => { void end("save"); }} data-testid="pinboard-entry-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <TextInput
        ref={titleRef}
        className="pv-pinentry-title"
        data-testid="pinboard-entry-title"
        value={title}
        placeholder={t("pinboard.entryTitlePlaceholder")}
        aria-label={t("pinboard.entryTitlePlaceholder")}
        onChange={(e) => {
          wantsTextRef.current = false;
          setTitle(e.target.value);
        }}
        onKeyDown={(e) => {
          // Enter (without Ctrl/Cmd) moves on to the text, like Tab.
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            focusEditor();
          }
        }}
      />
      {/* Inert while the entry ends: a keystroke between the flush and the
          rename would be saved to the OLD path and bring the draft back. */}
      <div ref={editorHostRef} className="pv-pinentry-editor" data-testid="pinboard-entry-editor" inert={busy} onFocusCapture={placeBodyCaret}>
        <Suspense fallback={<div className="pv-pinentry-loading">{t("common.loading", "Loading...")}</div>}>
          <LazyEditor activePath={draft.path} peek newEntry isActivePane={false} docChannel={channel} />
        </Suspense>
      </div>
      <div className="pv-pinentry-meta" data-testid="pinboard-entry-meta">
        {visibleChips.length > 0 && (
          <>
            <span>{t("pinboard.entryInherited")}</span>
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
            <span>{t("pinboard.entryInheritedHint")} ·</span>
          </>
        )}
        <span>{t("pinboard.entryTitleHint")}</span>
      </div>
    </Modal>,
    document.body,
  );
}
