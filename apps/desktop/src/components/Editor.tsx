import React, { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { BookOpen, Code, Pencil, ArrowLeft, ArrowRight, MoreVertical, Bookmark, Trash2, FoldHorizontal, UnfoldHorizontal, Copy, History, ClipboardCopy, FolderOpen, FolderTree, Printer, FileDown } from "lucide-react";
import { printElement } from "../services/printView";

import { EditorView } from '@codemirror/view';
import { useVault } from "../contexts/VaultContext";
import { useTranslation } from "react-i18next";
import { CustomDatePicker } from "./DatePicker";
import { TableSizePicker } from "./TableSizePicker";
import { TableContextMenu, type TableMenuAction, type TableAlignValue } from "./TableContextMenu";
import {
  buildMarkdownTable,
  planTableInsertion,
  parseMarkdownTable,
  serializeTable,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  setColumnAlign,
} from "@plainva/ui";
import { MarkdownReader } from "./MarkdownReader";
import { DocumentHeaderRead } from "./DocumentHeaderRead";
import { EmojiPicker, type EmojiPickerLabels } from "./EmojiPicker";
import { docIconValue } from "@plainva/ui";
import { HeaderColorPicker } from "./HeaderColorPicker";
import { frontmatterBlockOf, plainvaMetaFromBlock } from "@plainva/ui";
import { setFrontmatterPath, deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY, isPlainvaManagedIndex, stripPlainvaIndexMarker, type VaultFileInfo } from "@plainva/core";
import { BasePicker } from "./BasePicker";
import { createInlineBase, folderOf, baseEmbedText } from "../services/inlineBase";
import { generateIndexForFolder } from "../services/indexMd";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { activeDocument, type DocChannel } from "../services/activeDocument";
import { appConfirm, appPrompt } from "../services/appDialogs";
import { toast } from "@plainva/ui";
import { dirtyStore } from "../services/dirtyStore";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { readFile } from "@tauri-apps/plugin-fs";
import { noteEmbedPlugin } from "./NoteEmbedPlugin";
import { MenuSurface, MenuItem, MenuSeparator, MenuLabel } from "@plainva/ui";
import { duplicateFile, renameInitialName, renameToName } from "../services/fileActions";
import { rememberSessionViewMode, resolveViewModeForPath, type EditorViewMode } from "../services/viewModeDefault";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { requestSaveFlush } from "../services/saveFlush";
import { SplitButton, type SplitDirection } from "./SplitButton";
import { SelectionToolbar, type FormatAction } from "./SelectionToolbar";
import { BlockMenu } from "./BlockMenu";
import { applyBlockAction, performBlockMove, type BlockAction } from "@plainva/ui";
import { createEditorSession, type EditorSession, type EditorSessionDeps } from "@plainva/ui";
import { consumePendingSearchJump, findFirstMatch, findTextRange, selectAndRevealRange } from "@plainva/ui";
import { toggleTaskAtIndex } from "@plainva/ui";
import { decideDirtyExternalUpdate } from "@plainva/ui";
import { parkTreeReveal } from "@plainva/ui";

// In-flight writes per file (P1.7). MODULE level on purpose: after a pane is
// closed and reopened, the NEW editor instance must still wait for a write the
// previous instance started — otherwise it reads (and later re-saves) the
// pre-write content. Entries remove themselves once settled.
const pendingWrites = new Map<string, Promise<void>>();

export const Editor: React.FC<{
  activePath: string | null;
  onOpenPath?: (path: string, newTab: boolean) => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onDelete?: () => void;
  /** Tab retarget after the ⋮-menu rename (wired to the layout's renameTabPrefix). */
  onRenamed?: (oldPath: string, newPath: string) => void;
  onSplit?: (direction: SplitDirection) => void;
  activeSplitDirection?: SplitDirection;
  isActivePane?: boolean;
  /** Compact peek variant (Base-UX2 P5): hides the nav/toolbar row — the peek modal supplies its own actions. */
  peek?: boolean;
  /** Scoped live-document channel (a floating peek passes its own so its inline
   * Properties bind to the peek note, not the main pane). Defaults to the global. */
  docChannel?: DocChannel;
}> = ({ activePath, onOpenPath, onNavigateBack, onNavigateForward, canGoBack, canGoForward, isBookmarked, onToggleBookmark, onDelete, onRenamed, onSplit, activeSplitDirection, isActivePane = true, peek = false, docChannel }) => {
  const vaultContext = useVault();
  // Live-document channel this editor publishes to. A scoped channel (peek) drives
  // its own inline Properties; only the editor that owns the GLOBAL channel touches
  // the shared sidebar/status-bar selection stats.
  const channel = docChannel ?? activeDocument;
  const ownsGlobalStats = channel === activeDocument;
  const { vaultPath, queryService, vaultAdapter, indexer, triggerFileTreeUpdate } = vaultContext;
  const { t, i18n } = useTranslation();
  // Performance telemetry removed to reduce console noise
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => resolveViewModeForPath(activePath));
  // Readable line length (#1): "narrow" centers the text column like the read view;
  // "full" uses the whole pane. Persisted globally (like Obsidian's setting).
  const [editorWidth, setEditorWidth] = useState<'narrow' | 'full'>(
    () => (localStorage.getItem('plainva-editor-width') === 'full' ? 'full' : 'narrow')
  );

  // Managed index.md files are read-only with a banner (plan UI-UX P11): the
  // generator owns the body; "Trotzdem bearbeiten" strips the marker and the
  // file becomes a normal, manually maintained note.
  const isIndexFile = !!activePath && (activePath.split(/[/\\]/).pop() ?? "").toLowerCase() === "index.md";
  const managedIndex = isIndexFile && isPlainvaManagedIndex(content);
  // Path -> custom document icon, drawn in front of the listing links (read mode).
  const docIcons = useDocumentIcons();

  // Every file opens in the configured default view mode unless the user
  // manually switched the mode for it during this session (E1, plan
  // 2026-07-07). The managed-index guard below still wins.
  useEffect(() => {
    setViewMode(resolveViewModeForPath(activePath));
  }, [activePath]);

  useEffect(() => {
    if (managedIndex && viewMode !== 'read') setViewMode('read');
  }, [managedIndex, viewMode]);

  const refreshManagedIndex = async () => {
    if (!activePath || !vaultAdapter || !queryService) return;
    try {
      const folder = activePath.includes("/") ? activePath.slice(0, activePath.lastIndexOf("/")) : "";
      const heading = folder ? folder.split("/").pop()! : (vaultPath?.split(/[/\\]/).pop() ?? "Vault");
      await generateIndexForFolder({ adapter: vaultAdapter, queryService, folder, heading, subfoldersHeading: t("indexMd.subfoldersHeading"), skipBackup: true });
      indexer?.indexVaultFull().then(() => triggerFileTreeUpdate()).catch(() => {});
      window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: activePath } }));
    } catch (e) {
      console.error("[Editor] refreshing the managed index failed", e);
    }
  };

  const unlockManagedIndex = async () => {
    if (!activePath || !vaultAdapter) return;
    const ok = await appConfirm({ title: t("indexMd.editAnyway"), message: t("indexMd.editAnywayConfirm"), kind: "warning" });
    if (!ok) return;
    try {
      const stripped = stripPlainvaIndexMarker(content);
      await vaultAdapter.writeTextFile(activePath, stripped);
      setContent(stripped);
      setViewMode('live');
      rememberSessionViewMode(activePath, 'live');
    } catch (e) {
      console.error("[Editor] removing the managed marker failed", e);
    }
  };
  const toggleWidth = () => setEditorWidth(w => {
    const next = w === 'narrow' ? 'full' : 'narrow';
    try { localStorage.setItem('plainva-editor-width', next); } catch { /* ignore */ }
    return next;
  });
  const [showMenu, setShowMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // ---- ⋮-menu file actions (plan UI-Menüs 2026-07-05, P4) -------------------
  // Rename/duplicate share the file-tree implementation (services/fileActions);
  // the editor adds the prompt/toast shell around it.
  const handleMenuRename = async () => {
    if (!activePath || !vaultAdapter) return;
    const next = await appPrompt({
      title: t("common.rename", { defaultValue: "Umbenennen" }),
      initial: renameInitialName(activePath, false),
    });
    if (next == null) return;
    try {
      // Write any pending debounced save FIRST — after the rename it would
      // resurrect the old path (same handshake the version restore uses).
      await requestSaveFlush(activePath);
      const result = await renameToName({ adapter: vaultAdapter, queryService: queryService ?? null, oldPath: activePath, newName: next, isFolder: false });
      if (!result.ok) {
        if (result.reason === "already-exists") toast.error(t("dialogs.alreadyExistsMsg"));
        else if (result.reason === "invalid-name") toast.error(t("dialogs.invalidNameMsg"));
        return;
      }
      onRenamed?.(activePath, result.newPath);
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
      if (result.linkUpdateFailed) {
        toast.warning(t("dialogs.renameLinksFailed"));
      } else if (result.changedFiles > 0) {
        toast.success(t("dialogs.renameLinksUpdated", { links: result.renamedLinks, files: result.changedFiles }));
      }
      notifyFileOps([{ type: "move", from: activePath, to: result.newPath }]);
    } catch (err) {
      console.error("[Editor] rename failed", err);
      toast.error(t("dialogs.renameErrorMsg", { error: (err as Error).message }));
    }
  };

  const handleMenuDuplicate = async () => {
    if (!activePath || !vaultAdapter) return;
    try {
      await requestSaveFlush(activePath);
      const copy = await duplicateFile(vaultAdapter, activePath, t("fileTree.copySuffix"));
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "create", path: copy }]);
      onOpenPath?.(copy, true);
    } catch (err) {
      console.error("[Editor] duplicate failed", err);
      toast.error(t("dialogs.createErrorMsg", { error: (err as Error).message }));
    }
  };

  const handleMenuCopyPath = async () => {
    if (!activePath) return;
    try {
      await navigator.clipboard.writeText(activePath);
      toast.info(t("fileTree.pathCopied", "Pfad kopiert."));
    } catch (err) {
      console.warn("[Editor] copying the path failed", err);
    }
  };

  const handleMenuReveal = async () => {
    if (!activePath || !vaultPath) return;
    try {
      await revealItemInDir(`${vaultPath}/${activePath}`);
    } catch (err) {
      console.warn("[Editor] reveal in file manager failed", err);
      toast.error((err as Error)?.message ?? String(err));
    }
  };

  // In-app counterpart of "reveal in file manager": expand + select the file
  // in Plainva's own tree. Park + event: App un-collapses the sidebar /
  // switches to the files tab on the event; a mounted tree handles it live,
  // an unmounted one consumes the parked path when it mounts (lib/treeReveal).
  // The tree deliberately never auto-reveals on opening a file — only this
  // explicit menu action does.
  const handleMenuRevealInTree = () => {
    if (!activePath) return;
    parkTreeReveal(activePath);
    window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: activePath } }));
  };
  const [tablePicker, setTablePicker] = useState<{ x: number; y: number; pos: number } | null>(null);
  // `@` mention -> "Datum wählen…" opens the calendar at the caret (#4).
  const [dateMention, setDateMention] = useState<{ x: number; y: number; pos: number } | null>(null);
  // `/`-menu "Datenbank einbetten" opens the .base picker; embed lands at `pos` (#8).
  const [basePicker, setBasePicker] = useState<{ pos: number } | null>(null);
  // Floating formatting toolbar over a non-empty selection (#5).
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number; above: boolean } | null>(null);
  // Block handle menu (#7): opened from a block's drag grip.
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; from: number } | null>(null);
  // Document icon / header-color pickers (W3), anchored where the user clicked.
  const [iconPicker, setIconPicker] = useState<{ x: number; y: number } | null>(null);
  const [colorPicker, setColorPicker] = useState<{ x: number; y: number } | null>(null);
  // Emoji-into-text picker (/emoji), anchored at the caret.
  const [emojiTextPicker, setEmojiTextPicker] = useState<{ x: number; y: number } | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    x: number; y: number; from: number; to: number;
    kind: "header" | "body"; rowIndex: number; colIndex: number; align: TableAlignValue;
  } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const contentSyncTimeoutRef = useRef<number | null>(null);
  const isDirtyRef = useRef<boolean>(false);
  // The last on-disk content this editor knowingly produced or adopted (own
  // save, load, external adopt, auto-merge, restore); null before the first
  // load. Lets the external-update handler tell the watcher echo of our OWN
  // save apart from a genuine external change while the user keeps typing —
  // writing a .CONFLICT for that echo was the spurious-conflict bug.
  const lastPersistedRef = useRef<string | null>(null);
  // A sync conflict preserved the editor text in a .CONFLICT file; the target
  // file on disk now holds the OTHER side. Shown as a persistent banner (a
  // transient toast is too easy to miss for a "your text lives elsewhere now").
  const [conflictInfo, setConflictInfo] = useState<{ conflictPath: string } | null>(null);
  // Crash/draft recovery (P2.4): a journal snapshot survived that never made
  // it to disk — offered in a banner, applied only on explicit user action.
  const [draftOffer, setDraftOffer] = useState<{ text: string; savedAt: number } | null>(null);
  const draftRevisionRef = useRef(0);
  const draftTimerRef = useRef<number | null>(null);
  // The CodeMirror session lives OUTSIDE React (P1/P2, Gesamtplan
  // Editor-Stabilitaet 2026-07-05): one instance per open file, mounted into
  // this container; React re-renders never touch or reconfigure it.
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  // Mirror of `content` for effects that must read the latest value without
  // depending on it (the mount effect below), plus the loaded-file guard that
  // prevents mounting a session with the PREVIOUS file's text during a switch.
  const contentRef = useRef<string>("");
  const loadedPathRef = useRef<string | null>(null);
  // Scroll container around the read view / editor. Used to scope outline
  // navigation to this pane's read view instead of a document-wide id lookup
  // (which would hit the first/left pane in a split — #4).
  const readScrollRef = useRef<HTMLDivElement>(null);

  // ---- Save pipeline (P2) --------------------------------------------------
  // The session reports real edits via onDocChanged; the text is read from the
  // view AT SAVE TIME (never from a stale closure). The read-mode properties
  // fallback saves a fixed string instead.
  const persistText = async (val: string) => {
    if (!activePath || !vaultAdapter || !indexer) return;
    const path = activePath;

    // In-flight guard (P1.7): saves to the same file are chained, and a newly
    // loading editor waits for the chain — a tab switch mid-write can neither
    // race two writes nor read the pre-write content back.
    const previous = pendingWrites.get(path);
    // Draft snapshots taken AFTER this point must survive the journal clear
    // below — fix the covered revision before any awaiting happens.
    const revAtSave = draftRevisionRef.current;
    const run = (async () => {
      if (previous) {
        try { await previous; } catch { /* the previous failure was already reported */ }
      }
      let savedOrSafelyPreserved = false;
      try {
        setIsSaving(true);
        setSaveError(null);
        await vaultAdapter.writeTextFile(path, val);
        savedOrSafelyPreserved = true;
        // Remember what WE wrote so the watcher echo of this save is never
        // mistaken for an external change (the auto-merge case updates this via
        // plainva-auto-merged instead, since the adapter wrote merged content).
        lastPersistedRef.current = val;
        setConflictInfo(null);

        // Re-index only this file so FTS/tags/links are instantly updated.
        // indexFile RE-READS the file from disk so the index always matches what
        // the adapter actually wrote — including the auto-merge case where the
        // ConflictAware layer writes merged content, not `val`. We still pass the
        // file's REAL mtime from a stat (not Date.now()): a matching mtime lets
        // the watcher's echo detection skip re-indexing this save a second time
        // (WP5 5f). Fall back to the old approximation if the stat fails.
        let info: VaultFileInfo;
        try {
          info = await vaultAdapter.getFileInfo(path);
        } catch {
          info = { path, name: path.split(/[/\\]/).pop()!, isDirectory: false, mtime: Date.now(), size: val.length };
        }
        const metaChanged = await indexer.indexFile(info);
        // File-only refresh (P2.5/P2.7): a save never changes the folder
        // structure, and views not showing this path can skip their reload.
        // Skip the app-wide fileTreeVersion bump entirely on pure prose edits
        // (title/mode/tags/properties/links unchanged) — that fan-out re-fires
        // 8-12 uncached queries across every useVault() consumer and was the
        // source of the typing lag during autosave. FTS is already updated in
        // the DB above (search queries live), while LINK changes do report
        // metaChanged: the backlinks panel and loadGraphCached key off the
        // version, so a hand-typed [[link]] must bump it to become visible.
        if (metaChanged) triggerFileTreeUpdate([path]);
      } catch (e: any) {
        console.error("Failed to save file", e);
        setSaveError(e.message || String(e));
        if (e.name === "ConflictError" || e.message?.includes("Cannot automatically merge")) {
          const conflictPath = e.conflictPath ? e.conflictPath : null;
          savedOrSafelyPreserved = true;
          // Persistent banner instead of only a transient toast (P1.8): the
          // user must understand that the TARGET file now holds the other
          // side and their text lives in the .CONFLICT copy.
          setConflictInfo({ conflictPath: conflictPath ?? "" });
          toast.warning(t("dialogs.conflictSavedMsg", { path: conflictPath ?? ".CONFLICT" }));
        }
      } finally {
        setIsSaving(false);
        if (savedOrSafelyPreserved) {
          isDirtyRef.current = false;
          dirtyStore.set(path, false);
          // The buffer is on disk (or preserved as .CONFLICT) — the journal
          // entry up to the covered revision has served its purpose.
          if (vaultPath) {
            void import("../services/draftJournal")
              .then(({ clearDraft }) => clearDraft(vaultPath, path, revAtSave))
              .catch(() => {});
          }
        }
      }
    })();

    pendingWrites.set(path, run);
    try {
      await run;
    } finally {
      if (pendingWrites.get(path) === run) pendingWrites.delete(path);
    }
  };

  const scheduleSave = (getText: () => string) => {
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    if (!activePath || !vaultAdapter || !indexer) return;
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void persistText(getText());
    }, 1000); // 1s debounce
    // Draft journal (P2.4): snapshot the dirty buffer BEFORE the save fires
    // (400 ms < 1 s) so a hard crash between keystroke and save loses at most
    // the last snapshot window. A successful save clears the entry up to the
    // revision it covered; newer snapshots survive (latest wins).
    if (vaultPath) {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
      const draftVault = vaultPath;
      const draftPath = activePath;
      draftTimerRef.current = window.setTimeout(() => {
        draftTimerRef.current = null;
        const rev = ++draftRevisionRef.current;
        void import("../services/draftJournal")
          .then(({ recordDraft }) => recordDraft(draftVault, draftPath, getText(), rev))
          .catch(() => {});
      }, 400);
    }
  };

  // Session callback: a real (non-external) edit happened in the view.
  const onDocChanged = (view: EditorView) => {
    isDirtyRef.current = true;
    if (activePath) dirtyStore.set(activePath, true);
    // E3: debounce the React-state mirror — the status bar / properties panel
    // and the read mode read from `content`, the editor itself never does, so
    // typing no longer re-renders this component per keystroke. Very large
    // documents mirror less often (P2.10): doc.toString() allocates the WHOLE
    // document per tick, a visible stall in the multi-MB range.
    const mirrorDelay = view.state.doc.length > 512_000 ? 2000 : 150;
    if (contentSyncTimeoutRef.current) window.clearTimeout(contentSyncTimeoutRef.current);
    contentSyncTimeoutRef.current = window.setTimeout(() => {
      contentSyncTimeoutRef.current = null;
      setContent(view.state.doc.toString());
    }, mirrorDelay);
    scheduleSave(() => view.state.doc.toString());
  };

  // Read-mode properties edits have no editor view; save the given text as-is.
  const applyNonViewEdit = (val: string) => {
    if (val === contentRef.current) return;
    isDirtyRef.current = true;
    if (activePath) dirtyStore.set(activePath, true);
    setContent(val);
    scheduleSave(() => val);
  };

  // Read-mode task checkbox clicked (P3.1): flip the matching [ ]/[x] marker
  // in the source and run it through the normal save pipeline.
  const handleToggleTask = (index: number, checked: boolean) => {
    const result = toggleTaskAtIndex(contentRef.current, index, checked);
    if (result.changed) applyNonViewEdit(result.content);
  };

  // Print / save as PDF (P3.10): always prints the READ view — from live or
  // source mode the editor switches to read first (the CM surface with its
  // widgets does not print usefully), waits one frame for the render, prints.
  const handleMenuPrint = () => {
    const printNow = () => {
      const reader = readScrollRef.current?.querySelector<HTMLElement>(".markdown-reader");
      if (reader) void printElement(reader);
    };
    if (viewMode === "read") {
      printNow();
      return;
    }
    setViewMode("read");
    // Two frames: one for React to commit, one for the reader to lay out.
    requestAnimationFrame(() => requestAnimationFrame(printNow));
  };

  // "Export as Markdown…" (issue #6): saved-state copy via the OS save dialog.
  const handleMenuExportMarkdown = () => {
    if (!activePath || !vaultAdapter) return;
    void import("../services/exportNote")
      .then(({ exportNoteAsMarkdown }) => exportNoteAsMarkdown(vaultAdapter, activePath))
      .catch((e) => { console.error("[Editor] markdown export failed", e); toast.error(t("editor.exportFailed")); });
  };

  const openExternalUrl = (url: string) => {
    openUrl(url).catch((err) => {
      toast.error(t("dialogs.openWebLinkErrorMsg", { error: err }));
    });
  };

  // Frontmatter edits from the properties panel. The CURRENT text comes from
  // the view (the source of truth while an editor is mounted) — the `content`
  // state may lag behind by the E3 debounce and would yield stale offsets.
  const handlePropertiesChange = (newContent: string) => {
    const view = sessionRef.current?.view;
    if (view) {
      const current = view.state.doc.toString();
      const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
      const oldMatch = current.match(fmRegex);
      const newMatch = newContent.match(fmRegex);

      if (current.trim() === "") {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
          selection: { anchor: newContent.length }
        });
      } else if (oldMatch && newMatch) {
        view.dispatch({
          changes: {
            from: 0,
            to: oldMatch[0].replace(/\r\n/g, '\n').length,
            insert: newMatch[0]
          }
        });
      } else if (!oldMatch && newMatch) {
        view.dispatch({
          changes: {
            from: 0,
            to: 0,
            insert: newMatch[0]
          }
        });
      } else if (oldMatch && !newMatch) {
        view.dispatch({
          changes: {
            from: 0,
            to: oldMatch[0].replace(/\r\n/g, '\n').length,
            insert: ""
          }
        });
      } else {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent }
        });
      }
    } else {
      applyNonViewEdit(newContent);
    }
  };

  // Publish the live document to the shared channel (status bar + right-sidebar
  // Properties read from it) and bridge frontmatter edits back into this editor.
  useEffect(() => {
    // The GLOBAL channel is only driven by the focused pane (status bar +
    // right-sidebar Properties), so split panes don't fight over it. A scoped
    // channel (a floating peek) always publishes — it drives its own inline
    // Properties, independent of pane focus.
    if (ownsGlobalStats && !isActivePane) return;
    channel.set({ path: activePath, content: activePath ? content : "", kind: activePath ? "markdown" : "none" });
  }, [activePath, content, isActivePane, channel, ownsGlobalStats]);
  // Register a stable wrapper so the channel doesn't need re-registration on
  // every render (handlePropertiesChange is a fresh closure each time).
  const handlePropertiesChangeRef = useRef(handlePropertiesChange);
  useLayoutEffect(() => { handlePropertiesChangeRef.current = handlePropertiesChange; });
  useEffect(() => {
    if (ownsGlobalStats && !isActivePane) return;
    channel.registerApplyFrontmatter((c) => handlePropertiesChangeRef.current(c));
    return () => channel.registerApplyFrontmatter(null);
  }, [isActivePane, channel, ownsGlobalStats]);

  // Document icon + header color (W3): derived from the frontmatter block only,
  // so body edits on every keystroke don't re-parse YAML.
  const fmBlock = frontmatterBlockOf(content);
  const docMeta = React.useMemo(() => plainvaMetaFromBlock(fmBlock), [fmBlock]);

  // Current document text: the mounted view is the source of truth; the
  // `content` state (used in read mode) may lag by the E3 sync debounce.
  const currentText = () => sessionRef.current?.view.state.doc.toString() ?? content;

  const applyPlainvaValue = (key: "icon" | "header_color", value: string | null) => {
    try {
      const base = currentText();
      const next =
        value === null
          ? deleteFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, key])
          : setFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, key], value);
      if (next !== base) handlePropertiesChange(next);
    } catch (e) {
      console.warn("[Editor] updating plainva frontmatter failed", e);
    }
  };

  // Icon + tint are written together: emoji picks clear a stale tint, icon-set
  // picks ("lucide:<name>") persist their color in plainva.icon_color.
  const applyDocIcon = (value: string | null, color: string | null) => {
    try {
      const base = currentText();
      let next =
        value === null
          ? deleteFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "icon"])
          : setFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "icon"], value);
      next =
        color === null
          ? deleteFrontmatterPath(next, [PLAINVA_NAMESPACE_KEY, "icon_color"])
          : setFrontmatterPath(next, [PLAINVA_NAMESPACE_KEY, "icon_color"], color);
      if (next !== base) handlePropertiesChange(next);
    } catch (e) {
      console.warn("[Editor] updating plainva icon failed", e);
    }
  };

  // Slash commands `/icon` + `/header color` fire window events; anchor the
  // picker at the caret (fallback: top-left of the pane).
  useEffect(() => {
    if (!isActivePane) return;
    const anchorAtCursor = (): { x: number; y: number } => {
      const view = sessionRef.current?.view;
      if (view) {
        const coords = view.coordsAtPos(view.state.selection.main.head);
        if (coords) return { x: coords.left, y: coords.bottom + 6 };
      }
      const rect = readScrollRef.current?.getBoundingClientRect();
      return { x: (rect?.left ?? 100) + 32, y: (rect?.top ?? 100) + 48 };
    };
    const onOpenIcon = () => setIconPicker(anchorAtCursor());
    const onOpenColor = () => setColorPicker(anchorAtCursor());
    const onOpenEmoji = () => setEmojiTextPicker(anchorAtCursor());
    window.addEventListener("plainva-open-icon-picker", onOpenIcon);
    window.addEventListener("plainva-open-header-color", onOpenColor);
    window.addEventListener("plainva-open-emoji-picker", onOpenEmoji);
    return () => {
      window.removeEventListener("plainva-open-icon-picker", onOpenIcon);
      window.removeEventListener("plainva-open-header-color", onOpenColor);
      window.removeEventListener("plainva-open-emoji-picker", onOpenEmoji);
    };
  }, [isActivePane]);

  const emojiPickerLabels: EmojiPickerLabels = {
    searchPlaceholder: t("emojiPicker.search"),
    recent: t("emojiPicker.recent"),
    remove: t("emojiPicker.remove"),
    noResults: t("emojiPicker.noResults"),
    modeEmoji: t("emojiPicker.modeEmoji"),
    modeIcons: t("emojiPicker.modeIcons"),
    tint: t("emojiPicker.tint"),
    tintDefault: t("emojiPicker.tintDefault"),
    categories: {
      smileys: t("emojiPicker.catSmileys"),
      people: t("emojiPicker.catPeople"),
      animals: t("emojiPicker.catAnimals"),
      food: t("emojiPicker.catFood"),
      activities: t("emojiPicker.catActivities"),
      travel: t("emojiPicker.catTravel"),
      objects: t("emojiPicker.catObjects"),
      symbols: t("emojiPicker.catSymbols"),
    },
  };

  useEffect(() => {
    const handleInsertText = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string }>;
      const view = sessionRef.current?.view;
      if (view) {
        const textToInsert = customEvent.detail.text;
        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: textToInsert,
          },
          selection: { anchor: selection.from + textToInsert.length },
        });
        view.focus();
        // Trigger a change to update state since CodeMirror handles it internally but we need content state to reflect it eventually
        // Actually onChange will fire and update content automatically
      }
    };
    window.addEventListener("plainva-insert-text", handleInsertText);
    return () => window.removeEventListener("plainva-insert-text", handleInsertText);
  }, []);

  // Open the graphical table size picker at the caret (triggered by /table).
  useEffect(() => {
    const openPicker = () => {
      const view = sessionRef.current?.view;
      if (!view) return;
      const pos = view.state.selection.main.head;
      const coords = view.coordsAtPos(pos);
      setTablePicker({ x: coords?.left ?? 240, y: coords?.bottom ?? 160, pos });
    };
    window.addEventListener("plainva-open-table-picker", openPicker);
    return () => window.removeEventListener("plainva-open-table-picker", openPicker);
  }, []);

  // Jump to a heading (outline click, #10). Only the active pane responds so a
  // split doesn't scroll both editors; live/source scroll the CodeMirror view,
  // read mode scrolls the heading element within THIS pane's container (#4).
  useEffect(() => {
    const onGoto = (e: Event) => {
      if (!isActivePane) return;
      const detail = (e as CustomEvent).detail || {};
      const line = detail.line as number | undefined;
      const slug = detail.slug as string | undefined;
      if (viewMode === 'read') {
        if (slug && readScrollRef.current) {
          const escaped = slug.replace(/["\\]/g, "\\$&");
          const el = readScrollRef.current.querySelector(`[id="${escaped}"]`);
          if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      const view = sessionRef.current?.view;
      if (!view || !line) return;
      const ln = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: ln.from }, effects: EditorView.scrollIntoView(ln.from, { y: "start" }) });
      view.focus();
    };
    window.addEventListener("plainva-goto-heading", onGoto);
    return () => window.removeEventListener("plainva-goto-heading", onGoto);
  }, [isActivePane, viewMode]);

  // Print via the command palette (P3.10): the palette dispatches one window
  // event; only the active pane prints, like the outline jump above.
  useEffect(() => {
    const onPrint = () => { if (isActivePane) handleMenuPrint(); };
    window.addEventListener("plainva-print-active", onPrint);
    return () => window.removeEventListener("plainva-print-active", onPrint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivePane, viewMode]);

  // Open the calendar at the caret when the @-menu's "Datum wählen…" is chosen.
  useEffect(() => {
    const open = (e: Event) => {
      const pos = (e as CustomEvent).detail?.pos as number | undefined;
      const view = sessionRef.current?.view;
      if (!view || pos == null) return;
      const coords = view.coordsAtPos(Math.min(pos, view.state.doc.length));
      setDateMention({ x: coords?.left ?? 240, y: coords?.bottom ?? 160, pos });
    };
    window.addEventListener("plainva-open-date-mention", open);
    return () => window.removeEventListener("plainva-open-date-mention", open);
  }, []);

  // Insert the chosen date as a dynamic `@YYYY-MM-DD` token at the saved caret.
  const handleDateMentionSelect = (iso: string) => {
    const view = sessionRef.current?.view;
    if (view && dateMention) {
      const pos = Math.min(dateMention.pos, view.state.doc.length);
      const token = `@${iso}`;
      view.dispatch({ changes: { from: pos, insert: token }, selection: { anchor: pos + token.length }, userEvent: "input" });
      view.focus();
    }
    setDateMention(null);
  };

  // Insert a `![[path]]` base embed at a document position (#8).
  const embedBaseAtPos = (basePath: string, pos: number) => {
    const view = sessionRef.current?.view;
    if (!view) return;
    const p = Math.min(pos, view.state.doc.length);
    const text = baseEmbedText(basePath);
    view.dispatch({ changes: { from: p, insert: text }, selection: { anchor: p + text.length }, userEvent: "input" });
    view.focus();
  };

  // Create a new inline `.base` in the current note's folder and embed it.
  const createAndEmbedBase = useCallback(async (pos: number) => {
    if (!vaultAdapter || !indexer || !activePath) return;
    try {
      const folder = folderOf(activePath);
      const newPath = await createInlineBase(vaultAdapter, folder, t("editor.inlineBaseDefaultName", { defaultValue: "Datenbank" }), t("database.viewTable", { defaultValue: "Table" }));
      await indexer.indexVaultFull();
      triggerFileTreeUpdate();
      embedBaseAtPos(newPath, pos);
    } catch (e) {
      console.error("Failed to create inline base", e);
    }
  }, [vaultAdapter, indexer, activePath, t, triggerFileTreeUpdate]);

  // Open the .base picker (/ menu) or create one directly (@ / slash "new base").
  useEffect(() => {
    const openPicker = (e: Event) => setBasePicker({ pos: (e as CustomEvent).detail?.pos ?? 0 });
    const createBase = (e: Event) => createAndEmbedBase((e as CustomEvent).detail?.pos ?? 0);
    window.addEventListener("plainva-open-base-picker", openPicker);
    window.addEventListener("plainva-create-inline-base", createBase);
    return () => {
      window.removeEventListener("plainva-open-base-picker", openPicker);
      window.removeEventListener("plainva-create-inline-base", createBase);
    };
  }, [createAndEmbedBase]);

  // Wrap the current selection with Markdown markers (selection toolbar, #5).
  // Selection toolbar (#5). Inline formats TOGGLE: applying again removes the
  // markers instead of stacking them (feedback). Link always wraps.
  const applyFormat = (action: FormatAction) => {
    const view = sessionRef.current?.view;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (action === "link") {
      const insert = `[${text}](url)`;
      const urlAt = sel.from + 1 + text.length + 2; // the "url" placeholder
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: urlAt, head: urlAt + 3 }, userEvent: "input" });
      view.focus();
      return;
    }
    const marker = action === "bold" ? "**" : action === "italic" ? "*" : action === "strike" ? "~~" : action === "code" ? "`" : "==";
    const m = marker.length;
    const len = view.state.doc.length;
    const before = view.state.sliceDoc(Math.max(0, sel.from - m), sel.from);
    const after = view.state.sliceDoc(sel.to, Math.min(len, sel.to + m));
    // Italic ("*") must not strip bold ("**") markers.
    const boldClash = marker === "*" && (before.endsWith("**") || after.startsWith("**"));
    // Toggle off: markers sit just outside the selection.
    if (before === marker && after === marker && !boldClash) {
      view.dispatch({
        changes: [{ from: sel.from - m, to: sel.from }, { from: sel.to, to: sel.to + m }],
        selection: { anchor: sel.from - m, head: sel.to - m },
        userEvent: "input",
      });
      view.focus();
      return;
    }
    // Toggle off: the selection itself includes the markers.
    if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker) && !(marker === "*" && text.startsWith("**"))) {
      const inner = text.slice(m, text.length - m);
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: inner }, selection: { anchor: sel.from, head: sel.from + inner.length }, userEvent: "input" });
      view.focus();
      return;
    }
    // Toggle on: wrap, keeping the inner text selected.
    const insert = marker + text + marker;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + m, head: sel.from + m + text.length }, userEvent: "input" });
    view.focus();
  };

  // Resolve a wiki target (note title or path) and open it. Shared by the
  // wiki-link plugin and the rendered table-cell links (tableLinkHandlers).
  const openWikiTarget = async (linkText: string, newTab: boolean) => {
    if (!onOpenPath || !queryService) return;
    // If there's a header like [[target#header]], discard the header for the file search
    const searchTarget = linkText.trim().split("#")[0];

    const sql = `
      SELECT path FROM files
      WHERE title = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
      LIMIT 1
    `;
    const rows = await queryService.db.query(sql, [searchTarget, searchTarget, searchTarget + ".md"]);
    if (rows && rows.length > 0) {
      onOpenPath(rows[0].path, newTab);
    } else {
      toast.warning(t("dialogs.linkNotFoundMsg", { target: searchTarget }));
    }
  };

  // Block handle menu + drag reorder (#7).
  useEffect(() => {
    const onMenu = (e: Event) => {
      const d = (e as CustomEvent).detail as { from: number; x: number; y: number };
      setBlockMenu({ from: d.from, x: d.x, y: d.y });
    };
    const onMove = (e: Event) => {
      const d = (e as CustomEvent).detail as { from: number; targetFrom: number };
      const view = sessionRef.current?.view;
      if (!view) return;
      // Shared with the mobile shell (R1.2): list-separator guards included.
      performBlockMove(view, d.from, d.targetFrom);
    };
    window.addEventListener("plainva-open-block-menu", onMenu);
    window.addEventListener("plainva-move-block", onMove);
    return () => {
      window.removeEventListener("plainva-open-block-menu", onMenu);
      window.removeEventListener("plainva-move-block", onMove);
    };
  }, []);

  const handleBlockAction = (action: BlockAction) => {
    const view = sessionRef.current?.view;
    if (view && blockMenu) applyBlockAction(view, blockMenu.from, action);
    setBlockMenu(null);
    view?.focus();
  };

  // Smart paste (#10) + OS file drop (P3.2) share one import: the file is
  // copied into the note's folder, images embed as ![[…]], everything else
  // links as [[…]]. Dropped files keep their original name (numbered on
  // collision); pasted images get a timestamp name.
  const importFileAtSelection = async (file: File) => {
    const view = sessionRef.current?.view;
    if (!view || !vaultAdapter || !activePath) return;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isImage = file.type.startsWith("image/");
      const folder = folderOf(activePath);
      let name = (file.name || "").trim().replace(/[\\/]/g, "-");
      if (!name) {
        const ext = (file.type.split("/")[1] || "png").replace("+xml", "");
        const d = new Date();
        const p2 = (n: number) => String(n).padStart(2, "0");
        name = `Pasted-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
      }
      let path = folder ? `${folder}/${name}` : name;
      if (await vaultAdapter.exists(path)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        for (let n = 2; await vaultAdapter.exists(path); n++) {
          const numbered = `${stem}-${n}${ext}`;
          path = folder ? `${folder}/${numbered}` : numbered;
        }
      }
      await vaultAdapter.writeBinaryFile(path, buf);
      if (indexer) { await indexer.indexPath(path); triggerFileTreeUpdate([path]); }
      const insert = isImage ? `![[${path}]]` : `[[${path}]]`;
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: "input" });
    } catch (e) {
      console.error("Failed to import file", e);
      toast.error(t("editor.fileImportFailed", { name: file.name || "?" }));
    }
  };
  const saveAndEmbedImage = importFileAtSelection;

  const handlePaste = (event: ClipboardEvent, view: EditorView): boolean => {
    const cd = event.clipboardData;
    if (!cd) return false;
    const img = Array.from(cd.files || []).find((f) => f.type.startsWith("image/"));
    if (img && vaultAdapter && activePath) {
      event.preventDefault();
      void saveAndEmbedImage(img);
      return true;
    }
    const text = cd.getData("text/plain");
    const sel = view.state.selection.main;
    if (text && /^https?:\/\/\S+$/.test(text.trim()) && !sel.empty) {
      const selected = view.state.sliceDoc(sel.from, sel.to);
      const insert = `[${selected}](${text.trim()})`;
      event.preventDefault();
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: "input" });
      return true;
    }
    return false;
  };

  // OS file drop into the editor (P3.2): the sibling of smart paste — every
  // switcher tries dragging a file from the Explorer as one of the first
  // things. Text drags (CodeMirror selection drags) carry no files.
  const handleDrop = (event: DragEvent, view: EditorView): boolean => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0 || !vaultAdapter || !activePath) return false;
    event.preventDefault();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos != null) view.dispatch({ selection: { anchor: pos } });
    void (async () => {
      for (const file of files) {
        await importFileAtSelection(file);
      }
    })();
    return true;
  };

  // Insert a GFM table of the chosen size at the saved caret position.
  const handleTableSelect = (rows: number, cols: number) => {
    const view = sessionRef.current?.view;
    if (view && tablePicker) {
      const pos = Math.min(tablePicker.pos, view.state.doc.length);
      const docLen = view.state.doc.length;
      const built = buildMarkdownTable(rows, cols, t("editor.tableColumn", { defaultValue: "Spalte" }));
      const prev = pos >= 1 ? view.state.sliceDoc(pos - 1, pos) : "";
      const prevPrev = pos >= 2 ? view.state.sliceDoc(pos - 2, pos - 1) : "";
      const next = pos < docLen ? view.state.sliceDoc(pos, pos + 1) : "";
      const nextNext = pos + 1 < docLen ? view.state.sliceDoc(pos + 1, pos + 2) : "";
      const { insert, caretOffset } = planTableInsertion(built.text, prev, prevPrev, next, nextNext);
      // Land the caret on the line after the table so it renders as a widget
      // right away (TS3: cells are edited by clicking them, not the raw source).
      const caret = Math.min(pos + caretOffset, docLen + insert.length);
      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: caret },
        userEvent: "input",
      });
      view.focus();
    }
    setTablePicker(null);
  };

  // Open the table row/column context menu (dispatched by the live table widget
  // on right-click). Coordinates are viewport-relative.
  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        x: number; y: number; from: number; to: number;
        kind: "header" | "body"; rowIndex: number; colIndex: number; align: TableAlignValue;
      };
      setTableMenu(d);
    };
    window.addEventListener("plainva-open-table-menu", open);
    return () => window.removeEventListener("plainva-open-table-menu", open);
  }, []);

  // Apply a context-menu action. The model is re-parsed from the current
  // document (the source of truth) so the mutation always targets fresh state.
  const handleTableMenuAction = (action: TableMenuAction) => {
    const view = sessionRef.current?.view;
    if (view && tableMenu) {
      const { from, to, kind, rowIndex, colIndex } = tableMenu;
      const safeTo = Math.min(to, view.state.doc.length);
      // Delete the whole table (requirement #9): drop the table's source range plus
      // one trailing newline so no empty line is left behind. No model parse needed.
      if (action === "table-delete") {
        let end = safeTo;
        if (end < view.state.doc.length && view.state.sliceDoc(end, end + 1) === "\n") end++;
        view.dispatch({ changes: { from, to: end, insert: "" }, userEvent: "input" });
        view.focus();
        setTableMenu(null);
        return;
      }
      const model = parseMarkdownTable(view.state.sliceDoc(from, safeTo));
      if (model) {
        let next = model;
        switch (action) {
          case "row-above": next = insertRow(model, kind === "header" ? 0 : rowIndex); break;
          case "row-below": next = insertRow(model, kind === "header" ? 0 : rowIndex + 1); break;
          case "row-delete": next = deleteRow(model, rowIndex); break;
          case "col-left": next = insertColumn(model, colIndex); break;
          case "col-right": next = insertColumn(model, colIndex + 1); break;
          case "col-delete": next = deleteColumn(model, colIndex); break;
          case "align-left": next = setColumnAlign(model, colIndex, "left"); break;
          case "align-center": next = setColumnAlign(model, colIndex, "center"); break;
          case "align-right": next = setColumnAlign(model, colIndex, "right"); break;
        }
        view.dispatch({ changes: { from, to: safeTo, insert: serializeTable(next) }, userEvent: "input" });
        view.focus();
      }
    }
    setTableMenu(null);
  };

  // Keep the mirror in sync for effects that read the latest content without
  // depending on it (declared BEFORE the session mount effect: layout effects
  // run in declaration order).
  useLayoutEffect(() => { contentRef.current = content; });

  // Jump-to-match from the sidebar search (plan Suche P5/O1). The click parks
  // the request in the searchJump store — this pane may not even be mounted
  // yet (lazy Editor, first file open). Two consumers pick it up one-shot:
  // the poke event (already-mounted pane, incl. "file already open") and the
  // load effect below (pane mounted/switched after the click). Execution
  // retries per animation frame until content is loaded and painted; the
  // selection itself is the highlight.
  const searchJumpRafRef = useRef(0);
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; });
  const startSearchJump = (jump: { path: string; term: string }) => {
    cancelAnimationFrame(searchJumpRafRef.current);
    const tick = (attemptsLeft: number) => {
      if (attemptsLeft <= 0) return;
      const retry = () => { searchJumpRafRef.current = requestAnimationFrame(() => tick(attemptsLeft - 1)); };
      if (loadedPathRef.current !== jump.path) return retry();
      if (viewModeRef.current === 'read') {
        const root = readScrollRef.current;
        const range = root ? findTextRange(root, jump.term) : null;
        if (!range) return retry(); // read view may not have painted yet
        selectAndRevealRange(range);
        return;
      }
      const view = sessionRef.current?.view;
      if (!view) return retry(); // session mounts in a layout effect
      const match = findFirstMatch(view.state.doc.toString(), jump.term);
      if (!match) return; // e.g. an FTS diacritic-fold hit — silently skip
      view.dispatch({
        selection: { anchor: match.from, head: match.to },
        effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
      });
      view.focus();
    };
    tick(120); // ~2 s of frames covers load + first paint
  };
  useEffect(() => {
    if (!isActivePane) return;
    const onSearchJump = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      const jump = consumePendingSearchJump(detail?.path ?? null);
      if (jump) startSearchJump(jump);
    };
    window.addEventListener('plainva-search-jump', onSearchJump);
    return () => window.removeEventListener('plainva-search-jump', onSearchJump);
    // startSearchJump only touches refs — no stale state in the handler.
  }, [isActivePane]);
  useEffect(() => {
    if (!isActivePane || isLoading || !activePath) return;
    const jump = consumePendingSearchJump(activePath);
    if (jump) startSearchJump(jump);
  }, [isActivePane, isLoading, activePath]);
  useEffect(() => () => cancelAnimationFrame(searchJumpRafRef.current), []);

  // Load content when activePath changes
  useEffect(() => {
    if (!vaultAdapter || !activePath) {
      loadedPathRef.current = null;
      lastPersistedRef.current = null;
      setContent("");
      setIsLoading(false);
      setSaveError(null);
      return;
    }

    let isMounted = true;
    loadedPathRef.current = null;
    lastPersistedRef.current = null;
    setIsLoading(true);
    setConflictInfo(null);
    setDraftOffer(null);
    if (draftTimerRef.current) { window.clearTimeout(draftTimerRef.current); draftTimerRef.current = null; }
    // Wait for an in-flight write to this file (P1.7) — loading mid-write
    // would show the pre-write content and re-save it over the newer text.
    const inFlight = pendingWrites.get(activePath);
    const readAfterWrites = inFlight
      ? inFlight.catch(() => {}).then(() => vaultAdapter.readTextFile(activePath))
      : vaultAdapter.readTextFile(activePath);
    readAfterWrites.then(text => {
      if (isMounted) {
        loadedPathRef.current = activePath;
        // The freshly loaded disk state counts as "our" persisted baseline.
        lastPersistedRef.current = text.replace(/\r\n/g, '\n');
        setContent(text.replace(/\r\n/g, '\n'));
        setIsLoading(false);
        if (vaultAdapter.acknowledgeExternalUpdate) {
          vaultAdapter.acknowledgeExternalUpdate(activePath).catch(console.error);
        }
        // Crash/draft recovery (P2.4): a surviving journal snapshot that
        // differs from the disk state means an edit never made it to disk
        // (crash or failed save) — offer it in a banner, never auto-apply.
        if (vaultPath) {
          const normalized = text.replace(/\r\n/g, '\n');
          void import("../services/draftJournal").then(async ({ readDraft }) => {
            const draft = await readDraft(vaultPath, activePath);
            if (isMounted && draft && draft.text !== normalized) {
              setDraftOffer({ text: draft.text, savedAt: draft.savedAt });
            }
          }).catch(() => {});
        }
      }
    }).catch(e => {
      console.error("Failed to load file content:", e);
      if (isMounted) {
        loadedPathRef.current = activePath;
        setContent("Fehler beim Laden der Datei.");
        setIsLoading(false);
      }
    });

    return () => { isMounted = false; };
  }, [vaultAdapter, activePath, vaultPath]);

  // Listen for external updates
  useEffect(() => {
    // Adopt externally produced text WITHOUT replacing the whole document
    // (P5 jitter fix): identical content is a full no-op (the local watcher
    // also sees our own saves, and sync cycles often rewrite unchanged files),
    // otherwise the session dispatches only the changed range — annotated as
    // external (no dirty/save loop) and excluded from the undo history (E4),
    // with caret/scroll surviving instead of a full-doc rebuild jump.
    const applyExternalText = (text: string, reason: string) => {
      const session = sessionRef.current;
      if (session) {
        if (!session.applyExternalText(text)) {
          console.log(`[Editor] ${reason} for ${activePath} matches the editor content — nothing to reload`);
          return;
        }
        console.log(`[Editor] adopting ${reason} for ${activePath} as a minimal range change`);
      } else {
        // Read mode has no CodeMirror session and re-parses the WHOLE markdown
        // on a content change. Identical disk content (the 15 s no-op sync
        // tick / the watcher echo of our own save) must be a no-op here too —
        // otherwise the re-parse remounts the Mermaid diagram and it flickers.
        // (Live mode already gets this guard from session.applyExternalText.)
        if (text === contentRef.current) {
          console.log(`[Editor] ${reason} for ${activePath} matches the read view — nothing to reload`);
          return;
        }
        console.log(`[Editor] adopting ${reason} for ${activePath}`);
      }
      setContent(text);
    };

    const handleExternalUpdate = async (e: Event) => {
      const customEvent = e as CustomEvent<{path: string}>;
      if (customEvent.detail.path !== activePath || !activePath) return;
      const path = activePath;

      if (!isDirtyRef.current) {
        const text = await vaultAdapter!.readTextFile(path);
        lastPersistedRef.current = text.replace(/\r\n/g, '\n');
        applyExternalText(text.replace(/\r\n/g, '\n'), "external modification");
        if (vaultAdapter!.acknowledgeExternalUpdate) {
          await vaultAdapter!.acknowledgeExternalUpdate(path).catch(console.error);
        }
        return;
      }

      // The editor is DIRTY and the file changed on disk under us (another editor, a
      // sync pull, the OS). The old behavior — keep the draft, "handle it on save" —
      // lost data: the sync worker can advance our stored hash so the next save sees no
      // divergence and clobbers the newer external version with the stale draft, with no
      // .CONFLICT. Instead preserve the draft as a .CONFLICT sibling and adopt the
      // external version now, so neither side is lost and the user can merge.
      let disk: string;
      try {
        disk = (await vaultAdapter!.readTextFile(path)).replace(/\r\n/g, '\n');
      } catch (err) {
        console.error(`[Editor] external update: reading ${path} failed`, err);
        return; // keep the draft rather than risk losing it
      }
      const view = sessionRef.current?.view;
      const draft = view ? view.state.doc.toString() : contentRef.current;
      const action = decideDirtyExternalUpdate({ disk, draft, lastPersisted: lastPersistedRef.current });
      // The external change already matches our draft (e.g. the echo of our own push):
      // no conflict, just realign the dirty/sync state.
      if (action === "realign") {
        isDirtyRef.current = false;
        dirtyStore.set(path, false);
        if (vaultAdapter!.acknowledgeExternalUpdate) {
          await vaultAdapter!.acknowledgeExternalUpdate(path).catch(console.error);
        }
        return;
      }
      // The disk equals the last text WE persisted: the watcher echo of our own
      // save (or a stale-hash false positive from the sync push race) arriving
      // while the user kept typing. Not an external change — keep the newer
      // draft and the dirty flag; the scheduled save persists it normally.
      // Writing a .CONFLICT here was the spurious-conflict bug.
      if (action === "own-echo") {
        console.log(`[Editor] external update for ${path} matches our last save — own echo, keeping the draft`);
        return;
      }
      // Cancel a scheduled save so the stale draft cannot win right after we adopt.
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const extMatch = path.match(/(\.[^.]+)$/);
      const ext = extMatch ? extMatch[1] : "";
      const conflictBase = extMatch ? path.substring(0, path.length - ext.length) : path;
      const conflictPath = `${conflictBase}.CONFLICT-${timestamp}${ext}`;
      try {
        await vaultAdapter!.writeTextFile(conflictPath, draft);
      } catch (err) {
        console.error(`[Editor] external update: preserving draft as ${conflictPath} failed`, err);
        return; // don't adopt-and-lose; leave the draft in the editor
      }
      lastPersistedRef.current = disk;
      applyExternalText(disk, "external modification (draft preserved as conflict)");
      isDirtyRef.current = false;
      dirtyStore.set(path, false);
      if (vaultAdapter!.acknowledgeExternalUpdate) {
        await vaultAdapter!.acknowledgeExternalUpdate(path).catch(console.error);
      }
      setConflictInfo({ conflictPath });
      toast.warning(t("dialogs.conflictSavedMsg", { path: conflictPath }));
    };

    const handleAutoMerged = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string; mergedText: string }>;
      if (customEvent.detail.path === activePath) {
        // On save, external + local changes were auto-merged and written to disk.
        // Adopt the merged content so the next save does not overwrite the merge
        // with the stale pre-merge view (which would silently drop external changes).
        lastPersistedRef.current = customEvent.detail.mergedText.replace(/\r\n/g, '\n');
        applyExternalText(customEvent.detail.mergedText.replace(/\r\n/g, '\n'), "auto-merged content");
        isDirtyRef.current = false;
      }
    };

    // Version-restore handshake (Gesamtplan Backups & Versionierung, P5):
    // the modal asks for a flush BEFORE restoring — a pending 1-s save timer
    // would otherwise overwrite the restored content a second later. Always
    // ack, even when clean, so the modal never waits out its timeout.
    const handleFlushRequest = async (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (path !== activePath) return;
      try {
        if (saveTimeoutRef.current !== null) {
          window.clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        if (isDirtyRef.current) {
          const view = sessionRef.current?.view;
          await persistText(view ? view.state.doc.toString() : contentRef.current);
        }
      } finally {
        window.dispatchEvent(new CustomEvent("plainva-pending-save-flushed", { detail: { path } }));
      }
    };

    // Restored content bypasses the dirty guard of plainva-external-update on
    // purpose: the restore IS the user's latest intent. Cancel any scheduled
    // save so stale text cannot win afterwards.
    const handleFileRestored = (e: Event) => {
      const { path, content: restored } = (e as CustomEvent<{ path: string; content: string }>).detail;
      if (path !== activePath) return;
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      lastPersistedRef.current = restored.replace(/\r\n/g, "\n");
      applyExternalText(restored.replace(/\r\n/g, "\n"), "restored version");
      isDirtyRef.current = false;
      if (vaultAdapter?.acknowledgeExternalUpdate) {
        vaultAdapter.acknowledgeExternalUpdate(path).catch(console.error);
      }
    };

    window.addEventListener("plainva-external-update", handleExternalUpdate);
    window.addEventListener("plainva-auto-merged", handleAutoMerged);
    window.addEventListener("plainva-flush-pending-save", handleFlushRequest);
    window.addEventListener("plainva-file-restored", handleFileRestored);
    return () => {
      window.removeEventListener("plainva-external-update", handleExternalUpdate);
      window.removeEventListener("plainva-auto-merged", handleAutoMerged);
      window.removeEventListener("plainva-flush-pending-save", handleFlushRequest);
      window.removeEventListener("plainva-file-restored", handleFileRestored);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, vaultAdapter]);

  // ---- CodeMirror session (P1/P2) ------------------------------------------
  // Mutable host bindings for the session's stable extensions. Refreshed on
  // every render, BEFORE the mount effect below (declaration order). This is
  // the latest-ref pattern: deliberately no dependency array, nothing is
  // called here — only stored for the session to read later.
  const sessionDepsRef = useRef<EditorSessionDeps>(null as unknown as EditorSessionDeps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    sessionDepsRef.current = {
      queryService,
      vaultContext,
      hostPath: activePath ?? undefined,
      onOpenPath,
      openWikiTarget: (target, newTab) => { void openWikiTarget(target, newTab); },
      openExternalUrl,
      handlePaste,
      handleDrop,
      onDocChanged,
      onSelectionToolbar: setSelToolbar,
      // Selection counts for the status bar (P3.9): only the focused pane that
      // owns the global channel publishes, so split panes (and floating peeks)
      // don't fight over the shared channel.
      onSelectionStats: (stats) => { if (ownsGlobalStats && isActivePane) activeDocument.setSelectionStats(stats); },
      onPickIcon: setIconPicker,
      onPickColor: setColorPicker,
      // Shell capabilities injected into the shared session (ADR 0011).
      readBinaryFile: (absolutePath) => readFile(absolutePath),
      buildNoteEmbedExtension: (context, isLive) => noteEmbedPlugin(context, isLive),
    };
  });

  // Losing pane focus / switching files / closing the pane clears the
  // published selection — the fresh session starts unselected. A scoped-channel
  // editor (peek) never touches the global selection stats.
  useEffect(() => {
    if (!ownsGlobalStats || isActivePane) return;
    activeDocument.setSelectionStats(null);
  }, [isActivePane, ownsGlobalStats]);
  useEffect(() => { if (ownsGlobalStats) activeDocument.setSelectionStats(null); }, [activePath, ownsGlobalStats]);
  useEffect(() => () => { if (ownsGlobalStats) activeDocument.setSelectionStats(null); }, [ownsGlobalStats]);

  // One CodeMirror session per open file: created when the pane shows an
  // editor (live/source) with loaded content, destroyed on file switch / read
  // mode / unmount. A language switch rebuilds it (localized header labels).
  const isReadMode = viewMode === 'read';
  useLayoutEffect(() => {
    if (isLoading || isReadMode || !activePath || loadedPathRef.current !== activePath) return;
    const parent = editorContainerRef.current;
    if (!parent) return;
    const session = createEditorSession({
      parent,
      doc: contentRef.current,
      mode: viewMode === 'source' ? 'source' : 'live',
      vaultPath: vaultPath || "",
      i18n,
      headerTexts: {
        addIcon: t("docHeader.addIcon"),
        addColor: t("docHeader.addColor"),
        changeIcon: t("docHeader.changeIcon"),
        changeColor: t("docHeader.changeColor"),
      },
      deps: sessionDepsRef,
    });
    sessionRef.current = session;
    return () => {
      // Flush pending debounced work with the final text so (a) the read view
      // renders fresh content immediately and (b) the last edit window is
      // never lost on file switch / unmount. persistText is the closure of
      // THIS mount, so a pending save still targets the file it belongs to.
      const text = session.view.state.doc.toString();
      if (contentSyncTimeoutRef.current) {
        window.clearTimeout(contentSyncTimeoutRef.current);
        contentSyncTimeoutRef.current = null;
        setContent(text);
        contentRef.current = text;
      }
      if (saveTimeoutRef.current !== null && isDirtyRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        void persistText(text);
      }
      sessionRef.current = null;
      session.destroy();
    };
    // viewMode is handled by setMode below (the compartment swap keeps the
    // syntax tree); content is owned by the view while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isReadMode, activePath, vaultPath, i18n.language]);

  // Live <-> source switches swap ONE compartment — the parser state survives,
  // so nothing collapses or jumps.
  useEffect(() => {
    if (isReadMode) return;
    sessionRef.current?.setMode(viewMode === 'source' ? 'source' : 'live');
  }, [viewMode, isReadMode]);

  if (!activePath) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
        {t("editor.noActiveFileDesc")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {!peek && (
      <div style={{ padding: "0.5rem 1rem", flexShrink: 0, borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-primary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button 
            onClick={onNavigateBack} 
            disabled={!canGoBack}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: "transparent", border: "none", color: canGoBack ? "var(--text-muted)" : "var(--text-faint)", opacity: canGoBack ? 1 : 0.4, cursor: canGoBack ? "pointer" : "default", borderRadius: "var(--radius-xs)" }}
            title={t("editor.back")}
          >
            <ArrowLeft size={18} />
          </button>
          <button 
            onClick={onNavigateForward} 
            disabled={!canGoForward}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: "transparent", border: "none", color: canGoForward ? "var(--text-muted)" : "var(--text-faint)", opacity: canGoForward ? 1 : 0.4, cursor: canGoForward ? "pointer" : "default", borderRadius: "var(--radius-xs)" }}
            title={t("editor.forward")}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.8rem", color: saveError ? "var(--error-text)" : "var(--text-muted)" }} title={saveError || ""}>
            {isSaving ? t("editor.saving") : saveError ? t("editor.saveFailed") : t("editor.saved")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", padding: "2px" }}>
            <button 
              onClick={() => { setViewMode('read'); rememberSessionViewMode(activePath, 'read'); }}
              title={t("editor.readMode")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: viewMode === 'read' ? 'var(--bg-primary)' : 'transparent', border: "none", borderRadius: "var(--radius-xs)", color: viewMode === 'read' ? 'var(--accent-color)' : 'var(--text-muted)', cursor: "pointer", boxShadow: viewMode === 'read' ? 'var(--shadow-1)' : 'none' }}
            >
              <BookOpen size={16} />
            </button>
            <button
              onClick={() => { if (!managedIndex) { setViewMode('live'); rememberSessionViewMode(activePath, 'live'); } }}
              title={managedIndex ? t("indexMd.managedBanner") : t("editor.livePreview")}
              style={{ opacity: managedIndex ? 0.45 : 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: viewMode === 'live' ? 'var(--bg-primary)' : 'transparent', border: "none", borderRadius: "var(--radius-xs)", color: viewMode === 'live' ? 'var(--accent-color)' : 'var(--text-muted)', cursor: "pointer", boxShadow: viewMode === 'live' ? 'var(--shadow-1)' : 'none' }}
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => { if (!managedIndex) { setViewMode('source'); rememberSessionViewMode(activePath, 'source'); } }}
              title={managedIndex ? t("indexMd.managedBanner") : t("editor.sourceMode")}
              style={{ opacity: managedIndex ? 0.45 : 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: viewMode === 'source' ? 'var(--bg-primary)' : 'transparent', border: "none", borderRadius: "var(--radius-xs)", color: viewMode === 'source' ? 'var(--accent-color)' : 'var(--text-muted)', cursor: "pointer", boxShadow: viewMode === 'source' ? 'var(--shadow-1)' : 'none' }}
            >
              <Code size={16} />
            </button>
          </div>

          <button
            onClick={toggleWidth}
            title={editorWidth === 'narrow' ? t("editor.widthFull", { defaultValue: "Volle Breite" }) : t("editor.widthNarrow", { defaultValue: "Lesbare Breite" })}
            aria-label={editorWidth === 'narrow' ? t("editor.widthFull", { defaultValue: "Volle Breite" }) : t("editor.widthNarrow", { defaultValue: "Lesbare Breite" })}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", borderRadius: "var(--radius-xs)" }}
          >
            {editorWidth === 'narrow' ? <UnfoldHorizontal size={16} /> : <FoldHorizontal size={16} />}
          </button>

          <SplitButton onSplit={onSplit} activeDirection={activeSplitDirection} />
          <div style={{ position: "relative" }}>
            <button
              ref={menuBtnRef}
              onClick={() => setShowMenu(!showMenu)}
              title={t("editor.menu", { defaultValue: "Menu" })}
              aria-label={t("editor.menu", { defaultValue: "Menu" })}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              data-testid="editor-menu-btn"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", borderRadius: "var(--radius-xs)" }}
            >
              <MoreVertical size={16} />
            </button>
            {/* Grouped ⋮ menu on the shared MenuSurface (plan UI-Menüs P4). */}
            <MenuSurface
              open={showMenu}
              onClose={() => setShowMenu(false)}
              anchorRef={menuBtnRef}
              align="right"
              minWidth={230}
              ariaLabel={t("editor.menu", { defaultValue: "Menu" })}
            >
              <MenuLabel>{t("fileTree.groupFile", "Datei")}</MenuLabel>
              <MenuItem icon={<Pencil size={15} />} data-testid="editor-menu-rename" onSelect={() => { void handleMenuRename(); }}>
                {t("common.rename", { defaultValue: "Umbenennen" })}
              </MenuItem>
              <MenuItem icon={<Copy size={15} />} onSelect={() => { void handleMenuDuplicate(); }}>
                {t("fileTree.duplicate")}
              </MenuItem>
              {onToggleBookmark && (
                <MenuItem icon={<Bookmark size={15} fill={isBookmarked ? "currentColor" : "none"} />} onSelect={onToggleBookmark}>
                  {isBookmarked ? t("editor.removeBookmark", { defaultValue: "Lesezeichen entfernen" }) : t("editor.addBookmark", { defaultValue: "Lesezeichen hinzufügen" })}
                </MenuItem>
              )}
              <MenuItem
                icon={<History size={15} />}
                data-testid="editor-menu-version-history"
                onSelect={() => { if (activePath) window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: activePath } })); }}
              >
                {t("fileTree.versionHistory")}
              </MenuItem>
              <MenuItem icon={<ClipboardCopy size={15} />} onSelect={() => { void handleMenuCopyPath(); }}>
                {t("fileTree.copyPath")}
              </MenuItem>
              <MenuItem icon={<FolderTree size={15} />} data-testid="editor-menu-reveal-tree" onSelect={handleMenuRevealInTree}>
                {t("editor.revealInTree")}
              </MenuItem>
              <MenuItem icon={<FolderOpen size={15} />} onSelect={() => { void handleMenuReveal(); }}>
                {t("editor.revealInFileManager", "Im Dateimanager anzeigen")}
              </MenuItem>
              <MenuItem icon={<Printer size={15} />} onSelect={handleMenuPrint}>
                {t("editor.print")}
              </MenuItem>
              <MenuItem icon={<FileDown size={15} />} onSelect={handleMenuExportMarkdown}>
                {t("editor.exportMarkdown", "Als Markdown exportieren…")}
              </MenuItem>
              {onDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 size={15} />} onSelect={onDelete}>
                    {t("editor.delete", { defaultValue: "Löschen" })}
                  </MenuItem>
                </>
              )}
            </MenuSurface>
          </div>
        </div>
      </div>
      )}

      {conflictInfo && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-text)", fontSize: "0.8rem" }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            {conflictInfo.conflictPath
              ? t("editor.conflictBanner", { path: conflictInfo.conflictPath })
              : t("editor.conflictBannerNoPath")}
          </span>
          {conflictInfo.conflictPath && (
            <button
              type="button"
              className="pv-btn-secondary"
              style={{ padding: "4px 10px", fontSize: "0.78rem" }}
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-resolve-conflict", { detail: { path: conflictInfo.conflictPath } }))}
            >
              {t("conflict.resolveAction")}
            </button>
          )}
          {conflictInfo.conflictPath && onOpenPath && (
            <button type="button" className="pv-btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => onOpenPath(conflictInfo.conflictPath, true)}>
              {t("editor.conflictOpenCopy")}
            </button>
          )}
          <button type="button" className="pv-btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => setConflictInfo(null)}>
            {t("common.dismiss")}
          </button>
        </div>
      )}

      {draftOffer && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-text)", fontSize: "0.8rem" }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            {t("editor.draftBanner", { time: new Date(draftOffer.savedAt).toLocaleString() })}
          </span>
          <button
            type="button"
            className="pv-btn-secondary"
            style={{ padding: "4px 10px", fontSize: "0.78rem" }}
            onClick={() => {
              const offer = draftOffer;
              setDraftOffer(null);
              const view = sessionRef.current?.view;
              if (view) {
                // A plain user-visible edit: dirty + autosave + undoable.
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: offer.text } });
              } else {
                applyNonViewEdit(offer.text);
              }
            }}
          >
            {t("editor.draftRestore")}
          </button>
          <button
            type="button"
            className="pv-btn-secondary"
            style={{ padding: "4px 10px", fontSize: "0.78rem" }}
            onClick={() => {
              setDraftOffer(null);
              if (activePath && vaultPath) {
                void import("../services/draftJournal")
                  .then(({ clearDraft }) => clearDraft(vaultPath, activePath, Infinity))
                  .catch(() => {});
              }
            }}
          >
            {t("editor.draftDiscard")}
          </button>
        </div>
      )}

      <div ref={readScrollRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: "var(--bg-primary)", overflowY: viewMode === 'read' ? "auto" : "hidden" }}>
        {viewMode === 'read' ? (
          <>
            {managedIndex && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--border-color)", background: "var(--bg-secondary)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <span style={{ flex: 1, minWidth: 180 }}>{t("indexMd.managedBanner")}</span>
                <button type="button" className="pv-btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => void refreshManagedIndex()}>{t("indexMd.refreshNow")}</button>
                <button type="button" className="pv-btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }} onClick={() => void unlockManagedIndex()}>{t("indexMd.editAnyway")}</button>
              </div>
            )}
            <DocumentHeaderRead meta={docMeta} fullWidth={editorWidth === 'full'} />
            <div className={managedIndex ? "pv-index-doc" : undefined}>
              <MarkdownReader
                content={content}
                onOpenPath={onOpenPath}
                fullWidth={editorWidth === 'full'}
                sourcePath={activePath ?? undefined}
                docIcons={docIcons}
                showLinkIcons={managedIndex}
                onToggleTask={managedIndex ? undefined : handleToggleTask}
              />
            </div>
          </>
        ) : isLoading ? (
          <div style={{ padding: "2rem", color: "var(--text-faint)" }}>{t("editor.loadingFile")}</div>
        ) : (
          // The editor session (P1/P2) mounts CodeMirror into this container;
          // React only ever touches the div's attributes, never the editor.
          <div
            ref={editorContainerRef}
            // Readable line length (#1): center the text column when narrow.
            className={editorWidth === 'narrow' ? 'pv-cm-narrow' : undefined}
            // No overflow here: CodeMirror's own .cm-scroller handles scrolling,
            // and the wrapper (above) is overflow:hidden in editor mode, so there
            // is exactly one scroll container per view — no nested scrollbars (#4).
            style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: '16px' }}
          />
        )}
      </div>

      {tablePicker && (
        <TableSizePicker
          x={tablePicker.x}
          y={tablePicker.y}
          onSelect={handleTableSelect}
          onClose={() => setTablePicker(null)}
        />
      )}

      {iconPicker && (
        <EmojiPicker
          x={iconPicker.x}
          y={iconPicker.y}
          labels={emojiPickerLabels}
          showRemove={!!docMeta.icon}
          onSelect={(emoji) => { applyDocIcon(emoji, null); setIconPicker(null); }}
          onSelectIcon={(name, color) => { applyDocIcon(docIconValue(name), color); setIconPicker(null); }}
          onRemove={() => { applyDocIcon(null, null); setIconPicker(null); }}
          onClose={() => setIconPicker(null)}
        />
      )}

      {emojiTextPicker && (
        <EmojiPicker
          x={emojiTextPicker.x}
          y={emojiTextPicker.y}
          labels={emojiPickerLabels}
          emojiOnly
          onSelect={(emoji) => {
            const view = sessionRef.current?.view;
            if (view) {
              const sel = view.state.selection.main;
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert: emoji },
                selection: { anchor: sel.from + emoji.length },
                userEvent: "input.type",
              });
              view.focus();
            }
            setEmojiTextPicker(null);
          }}
          onSelectIcon={() => setEmojiTextPicker(null)}
          onClose={() => setEmojiTextPicker(null)}
        />
      )}

      {colorPicker && (
        <HeaderColorPicker
          x={colorPicker.x}
          y={colorPicker.y}
          value={docMeta.headerColor}
          onSelect={(color) => { applyPlainvaValue("header_color", color); setColorPicker(null); }}
          onRemove={() => { applyPlainvaValue("header_color", null); setColorPicker(null); }}
          onClose={() => setColorPicker(null)}
        />
      )}

      {dateMention && (
        <div style={{ position: "fixed", left: dateMention.x, top: dateMention.y, zIndex: 1000, minWidth: "180px" }}>
          <CustomDatePicker
            value=""
            autoOpen
            onChange={handleDateMentionSelect}
            onClose={() => setDateMention(null)}
          />
        </div>
      )}

      {basePicker && (
        <BasePicker
          onPick={(path) => { embedBaseAtPos(path, basePicker.pos); setBasePicker(null); }}
          onCreate={() => { const pos = basePicker.pos; setBasePicker(null); createAndEmbedBase(pos); }}
          onClose={() => setBasePicker(null)}
        />
      )}

      {viewMode !== 'read' && selToolbar && (
        <SelectionToolbar x={selToolbar.x} y={selToolbar.y} above={selToolbar.above} onAction={applyFormat} />
      )}

      {blockMenu && (
        <BlockMenu x={blockMenu.x} y={blockMenu.y} onAction={handleBlockAction} onClose={() => setBlockMenu(null)} />
      )}

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          kind={tableMenu.kind}
          align={tableMenu.align}
          onAction={handleTableMenuAction}
          onClose={() => setTableMenu(null)}
        />
      )}
    </div>
  );
};
