import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
import { BookOpen, Code, Pencil, ArrowLeft, ArrowRight, MoreVertical, Bookmark, Trash2, FoldHorizontal, UnfoldHorizontal, Copy, History, ClipboardCopy, FolderOpen, FolderTree, Printer, FileDown, ExternalLink, Database, Mail, Paperclip, FileX } from "lucide-react";
import { printElement } from "../services/printView";

import { EditorView } from '@codemirror/view';
import { getSettingsStore } from "../services/settingsStore";
import { attachmentFolderKey, useVault } from "../contexts/VaultContext";
import { useTranslation } from "react-i18next";
import { CustomDatePicker } from "./DatePicker";
import { TableSizePicker } from "./TableSizePicker";
import { TableContextMenu, type TableMenuAction, type TableAlignValue } from "./TableContextMenu";
import { Button, buildMarkdownTable, deleteColumn, deleteRow, ICON, insertColumn, insertRow, parseMarkdownTable, planPaste, planTableInsertion, serializeTable, setColumnAlign,
  errorText, importAttachment, useStableHandler,
} from "@plainva/ui";
import { MarkdownReader } from "./MarkdownReader";
import { DocumentHeaderRead } from "./DocumentHeaderRead";
import { NoteDatabaseBar } from "./NoteDatabaseBar";
import { isVirtualPath } from "./graph/virtualPaths";
import { loadNoteDatabaseContextCached } from "../services/noteDatabaseContextCache";
import { applyTextShape, isVaultPathLink, looksBinary, planRelativeLinkOpen, readTextShape, resolveOpenAction, resolveRelativeTarget, type LinkKind, type TextFileShape } from "@plainva/ui";
import { EMPTY_NOTE_DATABASE_CONTEXT, noteDisplayName, type NoteDatabaseContext } from "@plainva/ui";
import { EmojiPicker, type EmojiPickerLabels } from "./EmojiPicker";
import { docIconValue } from "@plainva/ui";
import { HeaderColorPicker } from "./HeaderColorPicker";
import { frontmatterBlockOf, frontmatterToAddress, plainvaMetaFromBlock, stripFrontmatter } from "@plainva/ui";
import { Banner, formatStampDate, staleSinceOf, trustBadgeOf, trustSignalsFromBlock } from "@plainva/ui";
import { setFrontmatterPath, deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY, isPlainvaManagedIndex, stripPlainvaIndexMarker, buildCommentAnchor, closeAnchorMarker, findAnchorMarker, mintAnchorMarkerId, openAnchorMarker, resolveCommentAnchor, type VaultFileInfo, type WorkspaceCommentAnchor, type WorkspaceCommentAnchorResolution, type WorkspacePolicyMember } from "@plainva/core";
import { WorkspaceCommentsColumn } from "./workspace/WorkspaceCommentsColumn";
import { BasePicker } from "./BasePicker";

import { generateIndexForFolder } from "../services/indexMd";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { useWikiResolver } from "../hooks/useWikiResolver";
import { activeDocument, type DocChannel } from "../services/activeDocument";
import { setEditorSelectionReader } from "../services/editorSelection";
import { appConfirm, appPrompt } from "../services/appDialogs";
import { toast } from "@plainva/ui";
import { dirtyStore } from "../services/dirtyStore";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { readFile } from "@tauri-apps/plugin-fs";
import { noteEmbedPlugin } from "./NoteEmbedPlugin";
import { MenuSurface, MenuItem, MenuSeparator, MenuLabel } from "@plainva/ui";
import { isOwnerWindow } from "../services/windowContext";
import { applyIndexChanges, duplicateFile, promptRenameFile } from "../services/fileActions";
import { getTemplateFolder } from "../services/newItemFlow";
import { TemplateTargetsModal } from "./TemplateTargetsModal";
import { rememberSessionViewMode, resolveViewModeForPath, type EditorViewMode } from "../services/viewModeDefault";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { requestSaveFlush } from "../services/saveFlush";
import { SplitButton, type SplitDirection } from "./SplitButton";
import { applySelectionFormat, baseEmbedText, createInlineBase, folderOf, SelectionToolbar, type FormatAction } from "@plainva/ui";
import { BlockMenu } from "./BlockMenu";
import { applyBlockAction, performBlockMove, type BlockAction } from "@plainva/ui";
import { createEditorSession, type EditorSession, type EditorSessionDeps } from "@plainva/ui";
import { consumePendingSearchJump, consumePendingTemplateCaret, findFirstMatch, findTextRange, selectAndRevealRange } from "@plainva/ui";
import { toggleTaskAtIndex } from "@plainva/ui";
import { decideDirtyExternalUpdate } from "@plainva/ui";
import { setWikiResolver } from "@plainva/ui";
import { parkTreeReveal } from "@plainva/ui";
import { imageMimeType } from "@plainva/ui";
import { openContextMenu } from "../services/contextMenuStore";
import { pendingWriteFor, trackPendingWrite } from "../services/pendingWrites";

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
  const { vaultPath, queryService, vaultAdapter, indexer, triggerFileTreeUpdate, workspaceSecurityStatus, getWorkspaceCapabilities, listWorkspaceComments, listWorkspaceMembers, postWorkspaceComment, resolveWorkspaceComment } = vaultContext;
  const { t, i18n } = useTranslation();
  // Performance telemetry removed to reduce console noise
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [workspaceCapabilities, setWorkspaceCapabilities] = useState<Awaited<ReturnType<typeof getWorkspaceCapabilities>>>(null);
  const [workspaceComments, setWorkspaceComments] = useState<Awaited<ReturnType<typeof listWorkspaceComments>>>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspacePolicyMember[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // The quote a NEW comment would attach to. Held as text, not as a range: the
  // selection moves on every keystroke, and re-rendering the editor that often
  // is the fan-out class this project has fought before. Only a changed quote
  // reaches React.
  const [selectionQuote, setSelectionQuote] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => resolveViewModeForPath(activePath));
  // Remembers the last editing sub-mode (live/source) so Mod+E restores it when
  // toggling back out of reading mode (default: live preview).
  const lastEditModeRef = useRef<EditorViewMode>("live");
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
  /**
   * A text file is not a note (C15). It has exactly one way to be shown — the
   * plain editor — so the three view modes do not apply: read mode would run a
   * `.csv` through the markdown renderer, and "source" versus "live" is a
   * distinction that only exists for markdown. The mode buttons are hidden and
   * the mode is pinned, the same shape the managed index.md guard below uses.
   */
  const isPlainText = !!activePath && resolveOpenAction(activePath) === "text";

  useEffect(() => {
    setViewMode(isPlainText ? "live" : resolveViewModeForPath(activePath));
  }, [activePath, isPlainText]);

  useEffect(() => {
    let active = true;
    if (!activePath || !workspaceSecurityStatus) { setWorkspaceCapabilities(null); return; }
    void getWorkspaceCapabilities(activePath).then((value) => { if (active) setWorkspaceCapabilities(value); }).catch(() => { if (active) setWorkspaceCapabilities([]); });
    return () => { active = false; };
  }, [activePath, getWorkspaceCapabilities, workspaceSecurityStatus]);
  const workspaceReadOnly = workspaceCapabilities !== null && !workspaceCapabilities.includes("content.write");
  const workspaceCanComment = workspaceCapabilities?.includes("comment.create") === true;
  const workspaceCanReadComments = workspaceCapabilities?.includes("comment.read") === true;
  useEffect(() => {
    if (!activePath || !workspaceCanReadComments) { setWorkspaceComments([]); return; }
    const refresh = () => void listWorkspaceComments(activePath).then(setWorkspaceComments).catch(() => setWorkspaceComments([]));
    const listener = (event: Event) => { if ((event as CustomEvent<{ path: string }>).detail?.path === activePath) refresh(); };
    refresh(); window.addEventListener("plainva-workspace-comments-changed", listener);
    return () => window.removeEventListener("plainva-workspace-comments-changed", listener);
  }, [activePath, listWorkspaceComments, workspaceCanReadComments]);

  useEffect(() => {
    let active = true;
    if (!workspaceCanReadComments) { setWorkspaceMembers([]); return; }
    void listWorkspaceMembers().then((members) => { if (active) setWorkspaceMembers(members); }).catch(() => { if (active) setWorkspaceMembers([]); });
    return () => { active = false; };
  }, [listWorkspaceMembers, workspaceCanReadComments]);

  // A name is a CLAIM the policy carries, not a verified identity - the card
  // keeps the member id reachable, so nobody has to take the name on faith.
  const memberNames = useMemo(() => new Map(workspaceMembers.map((member) => [member.memberId, member.displayName])), [workspaceMembers]);

  /**
   * Where each anchored comment currently lands, in RAW offsets - which is what
   * the editor document holds, so a resolution feeds a decoration directly.
   * Recomputed whenever the text or the comment list changes: that is what makes
   * a comment survive an edit above it without storing a position.
   */
  const anchorResolutions = useMemo(() => {
    const map = new Map<string, WorkspaceCommentAnchorResolution>();
    for (const comment of workspaceComments) {
      if (!comment.anchor) continue;
      map.set(comment.commentId, resolveCommentAnchor(content, comment.anchor as WorkspaceCommentAnchor));
    }
    return map;
  }, [workspaceComments, content]);

  useEffect(() => {
    if (managedIndex && viewMode !== 'read') setViewMode('read');
  }, [managedIndex, viewMode]);

  const refreshManagedIndex = async () => {
    if (!activePath || !vaultAdapter || !queryService) return;
    try {
      const folder = activePath.includes("/") ? activePath.slice(0, activePath.lastIndexOf("/")) : "";
      const heading = folder ? folder.split("/").pop()! : (vaultPath?.split(/[/\\]/).pop() ?? "Vault");
      await generateIndexForFolder({ adapter: vaultAdapter, queryService, folder, heading, subfoldersHeading: t("indexMd.subfoldersHeading"), skipBackup: true });
      // Only the folder's index.md changed — reindex just that (Issue #9).
      if (indexer) applyIndexChanges(indexer, { added: [folder ? `${folder}/index.md` : "index.md"] }).then(() => triggerFileTreeUpdate()).catch(() => {});
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
    await promptRenameFile(activePath, {
      adapter: vaultAdapter,
      queryService: queryService ?? null,
      indexer: indexer ?? null,
      t,
      prompt: appPrompt,
      toast,
      // Write any pending debounced save FIRST — after the rename it would
      // resurrect the old path (same handshake the version restore uses).
      flush: requestSaveFlush,
      templateFolder: () => (vaultPath ? getTemplateFolder(vaultPath) : Promise.resolve(undefined)),
      onRenamed,
      refresh: triggerFileTreeUpdate,
      notify: notifyFileOps,
    });
  };

  const handleMenuDuplicate = async () => {
    if (!activePath || !vaultAdapter) return;
    try {
      await requestSaveFlush(activePath);
      const copy = await duplicateFile(vaultAdapter, activePath, t("fileTree.copySuffix"));
      if (indexer) await applyIndexChanges(indexer, { added: [copy] });
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

  // Hand the note to the OS default handler for its type (e.g. Byword for
  // `.md`) — plain-Markdown interop, requested in issue #6. The file watcher
  // picks up external edits, so changes flow back into Plainva automatically.
  const handleMenuOpenInDefaultApp = async () => {
    if (!activePath || !vaultPath) return;
    try {
      await openPath(`${vaultPath}/${activePath}`);
    } catch (err) {
      console.warn("[Editor] open in default app failed", err);
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
  /**
   * Move this note into its own window (multi-window P1).
   *
   * Announced rather than executed here: the owner window holds the window list
   * and the tab layout, and it is the only place that can both open the window
   * and close the tab this note came from. In an auxiliary window the editor is
   * already IN its own window — the entry is hidden there.
   */
  const handleMenuOpenInNewWindow = () => {
    if (!activePath) return;
    window.dispatchEvent(new CustomEvent("plainva-open-in-new-window", { detail: { path: activePath } }));
  };
  const [tablePicker, setTablePicker] = useState<{ x: number; y: number; pos: number } | null>(null);
  // `@` mention -> "Datum wählen…" opens the calendar at the caret (#4).
  const [dateMention, setDateMention] = useState<{ x: number; y: number; pos: number } | null>(null);
  // `/`-menu "Datenbank einbetten" opens the .base picker; embed lands at `pos` (#8).
  const [basePicker, setBasePicker] = useState<{ pos: number } | null>(null);
  // "Ziel-Datenbanken…" dialog of a template note (plan Vorlagen-Datenbank-
  // Zuordnung P3); the ⋮ entry only shows for notes inside the template folder.
  const [showTemplateTargets, setShowTemplateTargets] = useState(false);
  const [isTemplateFile, setIsTemplateFile] = useState(false);
  useEffect(() => {
    let alive = true;
    setShowTemplateTargets(false);
    if (!vaultPath || !activePath || !activePath.toLowerCase().endsWith(".md")) {
      setIsTemplateFile(false);
      return;
    }
    getTemplateFolder(vaultPath)
      .then((folder) => {
        if (alive) setIsTemplateFile(activePath.startsWith(folder + "/"));
      })
      .catch(() => {
        if (alive) setIsTemplateFile(false);
      });
    return () => {
      alive = false;
    };
  }, [activePath, vaultPath]);
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
  /** Set when the file could not be read — rendered as a state, not as text. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * A file whose NAME says text and whose bytes say otherwise (C15, S13). The
   * extension is a claim: a rotated `.log` or a dump called `.csv` decodes to a
   * lossy string, and saving that string back destroys the file. So it is not
   * shown as text at all — the system app gets the offer instead.
   */
  const [notText, setNotText] = useState(false);
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
  // Resolver set for unresolved-link styling (maintainer 2026-07-18): pushed
  // into the CM view via a StateEffect; the ref lets the session-creation
  // effect seed a freshly created view without re-running on every resolver bump.
  const wikiResolver = useWikiResolver();
  const wikiResolverRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    wikiResolverRef.current = wikiResolver;
    const view = sessionRef.current?.view;
    if (view) view.dispatch({ effects: setWikiResolver.of(wikiResolver) });
  }, [wikiResolver]);
  // Mirror of `content` for effects that must read the latest value without
  // depending on it (the mount effect below), plus the loaded-file guard that
  // prevents mounting a session with the PREVIOUS file's text during a switch.
  const contentRef = useRef<string>("");
  const loadedPathRef = useRef<string | null>(null);
  /**
   * The shape a foreign text file arrived in (C15, S13).
   *
   * Notes are UTF-8/LF by house rule and keep being normalised on load. A
   * `.ini` from Windows or a `.csv` carrying the BOM Excel wants is not ours:
   * saving it back as LF would rewrite every line in the file — one edit, a
   * whole-file diff, and for a `.bat` a change in what the file DOES. Null for
   * anything that is not opened as text.
   */
  const textShapeRef = useRef<TextFileShape | null>(null);
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
    const previous = pendingWriteFor(vaultPath ?? "", path);
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
        // A foreign text file goes back in the shape it came in (C15, S13):
        // CRLF stays CRLF, a BOM stays a BOM. Notes have no shape here and
        // keep the project's UTF-8/LF.
        const shape = textShapeRef.current;
        await vaultAdapter.writeTextFile(path, shape ? applyTextShape(val, shape) : val);
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
        // Body-refresh channel (plan Pinboard P2): pure prose edits deliberately
        // do NOT bump fileTreeVersion (see below), but the pinboard view renders
        // note BODIES — it listens for this event and re-queries when the saved
        // path belongs to its source set. Dispatched AFTER indexFile so the FTS
        // row the view reads is already current. Cheap: nothing listens unless
        // a pinboard view is mounted.
        window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
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

    await trackPendingWrite(vaultPath ?? "", path, run);
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

  // Send via email (mail-client E5): the LIVE document (view = source of truth)
  // opens the compose dialog — inline as the body, or as a .md attachment.
  const currentDocText = () => sessionRef.current?.view?.state.doc.toString() ?? "";
  const noteTitleFromPath = () => (activePath?.split("/").pop() ?? "").replace(/\.md$/i, "");
  const handleMenuSendMail = () => {
    if (!activePath) return;
    // Strip the YAML frontmatter from the body (it must not travel in the mail)
    // and lift a reply-as-note `to:` into the recipient field.
    const text = currentDocText();
    window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail: { subject: noteTitleFromPath(), markdown: stripFrontmatter(text), to: frontmatterToAddress(text) ?? undefined } }));
  };
  const handleMenuSendMailAttachment = () => {
    if (!activePath) return;
    const bytes = new TextEncoder().encode(currentDocText());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const name = activePath.split("/").pop() ?? "note.md";
    window.dispatchEvent(
      new CustomEvent("plainva-compose-mail", {
        detail: { subject: noteTitleFromPath(), markdown: "", attachments: [{ name, mime: "text/markdown", contentBase64: btoa(bin) }] },
      })
    );
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
  // OKF 0.2 trust signals (plan P3a): the lifecycle badge in the read header
  // and the stale banner derive from the same block as the doc meta.
  const trustSignals = React.useMemo(() => trustSignalsFromBlock(fmBlock), [fmBlock]);
  const trustBadge = React.useMemo(() => trustBadgeOf(trustSignals), [trustSignals]);
  const staleSince = React.useMemo(() => staleSinceOf(trustSignals), [trustSignals]);
  const badgeTexts = React.useMemo(
    () => ({ statusDraft: t("docHeader.statusDraft"), statusDeprecated: t("docHeader.statusDeprecated") }),
    [t]
  );

  // Database context (plan P4): which database this note is a row of, its
  // parent and its sub-items. Derived from `.base` sources + the link index,
  // never written back; cached per (path, index version) so switching notes
  // does not re-parse every base. A failure leaves the bar hidden.
  const [dbContext, setDbContext] = useState<NoteDatabaseContext>(EMPTY_NOTE_DATABASE_CONTEXT);
  // Read as three values, not as `vaultContext`: the context object is a new
  // identity on every provider render, which would rebuild the context (and
  // re-parse every `.base`) on unrelated state changes.
  const { vaultAdapter: dbCtxAdapter, queryService: dbCtxQuery, fileTreeVersion: dbCtxVersion } = vaultContext;
  useEffect(() => {
    const adapter = dbCtxAdapter;
    const queryService = dbCtxQuery;
    const fileTreeVersion = dbCtxVersion;
    if (!activePath || !adapter || !queryService || isVirtualPath(activePath) || activePath.endsWith(".base")) {
      setDbContext(EMPTY_NOTE_DATABASE_CONTEXT);
      return;
    }
    let cancelled = false;
    void loadNoteDatabaseContextCached(adapter, queryService, activePath, fileTreeVersion).then((ctx) => {
      if (!cancelled) setDbContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [activePath, dbCtxAdapter, dbCtxQuery, dbCtxVersion]);

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
    clearSearch: t("sidebar.clearSearch"),
    recent: t("emojiPicker.recent"),
    remove: t("emojiPicker.remove"),
    noResults: t("emojiPicker.noResults"),
    modeEmoji: t("emojiPicker.modeEmoji"),
    modeIcons: t("emojiPicker.modeIcons"),
    tint: t("emojiPicker.tint"),
    tintDefault: t("emojiPicker.tintDefault"),
    tintCustom: t("emojiPicker.tintCustom"),
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
    iconCategories: {
      knowledge: t("emojiPicker.iconCategories.knowledge"),
      work: t("emojiPicker.iconCategories.work"),
      tech: t("emojiPicker.iconCategories.tech"),
      people: t("emojiPicker.iconCategories.people"),
      media: t("emojiPicker.iconCategories.media"),
      life: t("emojiPicker.iconCategories.life"),
      nature: t("emojiPicker.iconCategories.nature"),
      travel: t("emojiPicker.iconCategories.travel"),
      finance: t("emojiPicker.iconCategories.finance"),
      symbols: t("emojiPicker.iconCategories.symbols"),
    },
  };

  useEffect(() => {
    const handleInsertText = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string; cursorOffset?: number }>;
      const view = sessionRef.current?.view;
      if (view) {
        const textToInsert = customEvent.detail.text;
        const { cursorOffset } = customEvent.detail;
        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: textToInsert,
          },
          // A template can mark the caret with {{cursor}}; otherwise land at the end.
          selection: { anchor: selection.from + (cursorOffset ?? textToInsert.length) },
        });
        view.focus();
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

  // Toggle the view mode from the global keyboard shortcuts: Mod+E flips
  // reading↔editing (restoring the last edit sub-mode), Mod+Shift+E flips live
  // preview↔source. Only the active pane reacts; managed OKF index.md stays
  // locked to reading.
  useEffect(() => {
    const onToggle = (e: Event) => {
      // A plain text file has one mode; the shortcuts must not reach past the
      // hidden buttons and put a `.csv` into the markdown reader.
      if (!isActivePane || managedIndex || isPlainText) return;
      const axis = (e as CustomEvent).detail?.axis as "read" | "source" | undefined;
      let next: EditorViewMode | null = null;
      if (axis === "read") {
        if (viewMode === "read") next = lastEditModeRef.current || "live";
        else { lastEditModeRef.current = viewMode; next = "read"; }
      } else if (axis === "source") {
        next = viewMode === "source" ? "live" : "source";
      }
      if (next && next !== viewMode) {
        setViewMode(next);
        if (activePath) rememberSessionViewMode(activePath, next);
      }
    };
    window.addEventListener("plainva-toggle-view-mode", onToggle);
    return () => window.removeEventListener("plainva-toggle-view-mode", onToggle);
  }, [isActivePane, managedIndex, isPlainText, viewMode, activePath]);

  // Rename the active note from the global F2 shortcut (mirrors the ⋮ menu,
  // including the save-flush + link-update chain).
  useEffect(() => {
    const onRename = () => { if (isActivePane) void handleMenuRename(); };
    window.addEventListener("plainva-rename-active", onRename);
    return () => window.removeEventListener("plainva-rename-active", onRename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivePane]);

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
      await applyIndexChanges(indexer, { added: [newPath] });
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
    // Shared with the phone since S18: the six actions must not differ.
    applySelectionFormat(view, action, () =>
      toast.info(t("editor.fmtMultilineLink", { defaultValue: "Links können nur innerhalb einer Zeile erstellt werden." })),
    );
  };

  useEffect(() => {
    const onConflict = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: EditorView }>).detail;
      if (detail?.view !== sessionRef.current?.view) return;
      toast.info(t("editor.blockFormatConflict", { defaultValue: "Eine Zeile kann nicht gleichzeitig Überschrift und Aufgabe sein. Nutze Fett für einen hervorgehobenen Aufgabentitel." }));
    };
    window.addEventListener("plainva-editor-block-format-conflict", onConflict);
    return () => window.removeEventListener("plainva-editor-block-format-conflict", onConflict);
  }, [t]);

  // Resolve a clicked in-app link and open it. Shared by the wiki-link plugin
  // and the rendered table-cell links (tableLinkHandlers).
  //
  // `kind` matters (issue #61). A WIKI target is a name the index resolves, and
  // a miss there is an invitation to create the note (Obsidian parity,
  // 2026-07-18). A relative MARKDOWN target is a path on disk: it gets resolved
  // against this note's folder, and a miss is a missing file — never a new note
  // called `../_resources/x.mp3.md`.
  const openWikiTarget = async (linkText: string, newTab: boolean, kind?: LinkKind) => {
    if (!onOpenPath || !queryService) return;

    if (kind === "markdown" && activePath && isVaultPathLink(linkText)) {
      const target = resolveRelativeTarget(activePath, linkText);
      if (target) {
        // Same rule the reading view uses — one function, two renderers.
        const outcome = vaultAdapter
          ? await planRelativeLinkOpen(target, (p) => vaultAdapter.exists(p))
          : { action: "notFound" as const, path: target.path };
        if (outcome.action === "open") onOpenPath(outcome.path, newTab);
        else if (outcome.action === "revealFolder") window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: outcome.path } }));
        else toast.warning(t("dialogs.linkNotFoundMsg", { target: outcome.path }));
        return;
      }
    }

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
      // Target note doesn't exist yet — create it (Obsidian parity, maintainer
      // 2026-07-18). App owns the write/index/open (+ optional confirm).
      window.dispatchEvent(new CustomEvent("plainva-create-note-from-link", { detail: { target: searchTarget, hostPath: activePath, newTab } }));
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

  // Smart paste (#10), OS file drop (P3.2) and the file picker (#56) share one
  // import: the file is copied into the attachment folder, images embed as
  // ![[…]], everything else links as [[…]]. Dropped, copied and picked files
  // keep their original name (numbered on collision); clipboard bitmaps arrive
  // without one and get a timestamp. The naming and the reference live in
  // @plainva/ui so the phone produces the same thing — it used to write
  // `![[Report.pdf]]` and draw a broken image for it.
  const importBytesAtSelection = async (file: { name: string; mime: string; bytes: Uint8Array }) => {
    const view = sessionRef.current?.view;
    if (!view || !vaultAdapter || !activePath) return;
    try {
      // The folder is a setting now (S17). It used to be "beside the note",
      // which scatters attachments across every folder that ever received one
      // and leaves them behind when the note moves. An empty setting keeps the
      // old behaviour on purpose.
      const configured = (await getSettingsStore().then((st) => st.get<string>(attachmentFolderKey(vaultPath ?? "")))) ?? "Attachments";
      const { path, insert } = await importAttachment(
        file,
        { configuredFolder: configured, noteFolder: folderOf(activePath) },
        {
          exists: (candidate) => vaultAdapter.exists(candidate),
          createDir: (dir) => vaultAdapter.createDir(dir),
          writeBinaryFile: (p, bytes) => vaultAdapter.writeBinaryFile(p, bytes),
        },
      );
      if (indexer) { await indexer.indexPath(path); triggerFileTreeUpdate([path]); }
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: "input" });
    } catch (e) {
      console.error("Failed to import file", e);
      toast.error(t("editor.fileImportFailed", { name: file.name || "?" }));
    }
  };

  const importFileAtSelection = async (file: File) =>
    importBytesAtSelection({ name: file.name || "", mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });

  /**
   * Attach a file from the computer (issue #56). Until now dragging from the
   * file manager was the ONLY way to get an arbitrary file into a note — a
   * gesture nobody discovers from inside the app, and one that a maximised
   * window makes awkward.
   *
   * The dialog gives paths, not File objects, so the bytes come from plugin-fs
   * and the MIME type is left empty on purpose: importAttachment falls back to
   * the file extension, which is the only signal a path carries.
   */
  const attachFile = useStableHandler(async () => {
    if (!vaultAdapter || !activePath) return;
    let picked: string | string[] | null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      picked = await open({ multiple: true, title: t("editor.attachFile", { defaultValue: "Datei anhängen…" }) });
    } catch (e) {
      console.error("Failed to open the file dialog", e);
      return;
    }
    if (!picked) return; // Dismissed.
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      const name = p.split(/[/\\]/).pop() ?? p;
      try {
        const bytes = await readFile(p);
        await importBytesAtSelection({ name, mime: "", bytes });
      } catch (e) {
        console.error("Failed to read the picked file", e);
        toast.error(t("editor.attachFileFailed", { name, error: errorText(e) }));
      }
    }
  });

  // The slash command reaches every mounted editor, so only the focused pane
  // may answer — in a split the file would otherwise land wherever the first
  // listener happened to be. Its own effect (rather than a line in the picker
  // effect above) because `attachFile` is declared down here: a const is not
  // hoisted, and reading it earlier is a runtime error, not a lint nicety.
  useEffect(() => {
    if (!isActivePane) return;
    const onAttachFile = () => { void attachFile(); };
    window.addEventListener("plainva-attach-file", onAttachFile);
    return () => window.removeEventListener("plainva-attach-file", onAttachFile);
  }, [isActivePane, attachFile]);

  const handlePaste = (event: ClipboardEvent, view: EditorView): boolean => {
    const cd = event.clipboardData;
    if (!cd) return false;
    const sel = view.state.selection.main;
    // The decision is shared with the phone (S17) so a paste means the same
    // thing on both; only the storing differs.
    const plan = planPaste(Array.from(cd.files || []), cd.getData("text/plain"), {
      empty: sel.empty,
      text: view.state.sliceDoc(sel.from, sel.to),
    });
    if (plan.kind === "file" && vaultAdapter && activePath) {
      event.preventDefault();
      void importFileAtSelection(plan.file);
      return true;
    }
    if (plan.kind === "link") {
      event.preventDefault();
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: plan.insert }, selection: { anchor: sel.from + plan.insert.length }, userEvent: "input" });
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

  // `{{cursor}}` of a template the note was just created from (plan
  // Vorlagen-Engine, P3). Same two consumers and the same retry loop as the
  // search jump above — the pane is usually mounted only AFTER the file was
  // written. Read mode has no caret, so the jump simply does not apply there.
  const caretRafRef = useRef(0);
  const startTemplateCaret = (caret: { path: string; offset: number }) => {
    cancelAnimationFrame(caretRafRef.current);
    const tick = (attemptsLeft: number) => {
      if (attemptsLeft <= 0) return;
      const retry = () => { caretRafRef.current = requestAnimationFrame(() => tick(attemptsLeft - 1)); };
      if (loadedPathRef.current !== caret.path) return retry();
      if (viewModeRef.current === 'read') return;
      const view = sessionRef.current?.view;
      if (!view) return retry();
      // The offset comes from the template text; the note on disk carries the
      // OKF frontmatter in front of it, so clamp instead of trusting it.
      const pos = Math.min(Math.max(caret.offset, 0), view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
    };
    tick(120);
  };
  useEffect(() => {
    if (!isActivePane) return;
    const onCaret = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      const caret = consumePendingTemplateCaret(detail?.path ?? null);
      if (caret) startTemplateCaret(caret);
    };
    window.addEventListener('plainva-template-caret', onCaret);
    return () => window.removeEventListener('plainva-template-caret', onCaret);
  }, [isActivePane]);
  useEffect(() => {
    if (!isActivePane || isLoading || !activePath) return;
    const caret = consumePendingTemplateCaret(activePath);
    if (caret) startTemplateCaret(caret);
  }, [isActivePane, isLoading, activePath]);
  useEffect(() => () => cancelAnimationFrame(caretRafRef.current), []);

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
    setLoadError(null);
    setNotText(false);
    setConflictInfo(null);
    setDraftOffer(null);
    if (draftTimerRef.current) { window.clearTimeout(draftTimerRef.current); draftTimerRef.current = null; }
    // Wait for an in-flight write to this file (P1.7) — loading mid-write
    // would show the pre-write content and re-save it over the newer text.
    const inFlight = pendingWriteFor(vaultPath ?? "", activePath);
    const readAfterWrites = inFlight
      ? inFlight.catch(() => {}).then(() => vaultAdapter.readTextFile(activePath))
      : vaultAdapter.readTextFile(activePath);
    readAfterWrites.then(text => {
      if (isMounted) {
        loadedPathRef.current = activePath;
        // A foreign text file keeps its own shape; a note is normalised as it
        // always was (C15, S13).
        const isText = resolveOpenAction(activePath) === "text";
        // …and only if its bytes agree with its name. The check runs on the
        // decoded text we already hold: a 0x00 byte decodes to U+0000, so this
        // is the same evidence without reading the file a second time.
        if (isText && looksBinary(text)) {
          setNotText(true);
          setIsLoading(false);
          return;
        }
        const shaped = isText ? readTextShape(text) : null;
        textShapeRef.current = shaped?.shape ?? null;
        const normalized = shaped ? shaped.text : text.replace(/\r\n/g, '\n');
        // The freshly loaded disk state counts as "our" persisted baseline.
        lastPersistedRef.current = normalized;
        setContent(normalized);
        setIsLoading(false);
        if (vaultAdapter.acknowledgeExternalUpdate) {
          vaultAdapter.acknowledgeExternalUpdate(activePath).catch(console.error);
        }
        // Crash/draft recovery (P2.4): a surviving journal snapshot that
        // differs from the disk state means an edit never made it to disk
        // (crash or failed save) — offer it in a banner, never auto-apply.
        if (vaultPath) {
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
        // A missing file is a STATE, never content (issue #34): the error text
        // used to land in the editor buffer, so the next keystroke made the
        // autosave write "Fehler beim Laden der Datei." to disk — recreating a
        // deleted note with the error message as its body. `loadedPathRef`
        // stays null, which keeps the save path shut.
        setLoadError(e instanceof Error ? e.message : String(e));
        setContent("");
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

    /**
     * Tab menu → "Neu laden" (P2): re-read THIS file from disk. The per-file
     * sibling of P1's vault-wide reconcile, for the case "I edited the open
     * note in another program". A dirty buffer wins — discarding what the user
     * typed without asking would be the one unrecoverable outcome here.
     */
    const handleReloadFile = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (path !== activePath || !vaultAdapter) return;
      if (isDirtyRef.current) {
        toast.warning(t("tabMenu.reloadDirty", { defaultValue: "Ungespeicherte Änderungen — erst speichern, dann neu laden." }));
        return;
      }
      void vaultAdapter
        .readTextFile(path)
        .then((disk) => {
          const normalized = disk.replace(/\r\n/g, "\n");
          lastPersistedRef.current = normalized;
          applyExternalText(normalized, "reloaded from disk");
          isDirtyRef.current = false;
        })
        .catch((err) => {
          console.error("[Editor] reloading the file failed", err);
          toast.error(t("refresh.failed", { defaultValue: "Vault konnte nicht neu eingelesen werden." }));
        });
    };

    window.addEventListener("plainva-external-update", handleExternalUpdate);
    window.addEventListener("plainva-auto-merged", handleAutoMerged);
    window.addEventListener("plainva-flush-pending-save", handleFlushRequest);
    window.addEventListener("plainva-file-restored", handleFileRestored);
    window.addEventListener("plainva-reload-file", handleReloadFile);
    return () => {
      window.removeEventListener("plainva-external-update", handleExternalUpdate);
      window.removeEventListener("plainva-auto-merged", handleAutoMerged);
      window.removeEventListener("plainva-flush-pending-save", handleFlushRequest);
      window.removeEventListener("plainva-file-restored", handleFileRestored);
      window.removeEventListener("plainva-reload-file", handleReloadFile);
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
      openWikiTarget: (target, newTab, kind) => { void openWikiTarget(target, newTab, kind); },
      openExternalUrl,
      handlePaste,
      handleDrop,
      onDocChanged,
      onSelectionToolbar: setSelToolbar,
      // Selection counts for the status bar (P3.9): only the focused pane that
      // owns the global channel publishes, so split panes (and floating peeks)
      // don't fight over the shared channel.
      onSelectionStats: (stats) => { if (ownsGlobalStats && isActivePane) activeDocument.setSelectionStats(stats); },
      onSelectionRange: (range) => {
        // Only a CHANGED quote is worth a render - see the state declaration.
        const view = sessionRef.current?.view;
        const next = range && view ? view.state.sliceDoc(range.from, Math.min(range.to, range.from + 120)) : null;
        setSelectionQuote((previous) => (previous === next ? previous : next));
      },
      onAnchorActivate: (commentId) => setActiveCommentId(commentId),
      onPickIcon: setIconPicker,
      onPickColor: setColorPicker,
      // Shell capabilities injected into the shared session (ADR 0011).
      readBinaryFile: (absolutePath) => readFile(absolutePath),
      onImageContext: (e, absolutePath) => openContextMenu({
        x: e.clientX, y: e.clientY, selection: "", editable: null,
        image: { loadBytes: () => readFile(absolutePath), filename: absolutePath.split(/[/\\]/).pop() ?? "image", mime: imageMimeType(absolutePath) },
      }),
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

  // `{{selection}}` reads the marked text from the ACTIVE pane, on demand
  // (plan Vorlagen-Engine P5). A reader rather than a published value: the
  // selection changes on every cursor move, the token is asked for once.
  useEffect(() => {
    if (!ownsGlobalStats || !isActivePane) return;
    setEditorSelectionReader(() => {
      const view = sessionRef.current?.view;
      if (!view) return null;
      return view.state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => view.state.sliceDoc(r.from, r.to))
        .join("\n") || null;
    });
    return () => setEditorSelectionReader(null);
  }, [ownsGlobalStats, isActivePane]);

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
      // A text file is not a note (C15, S14) — same rule that decided it opens
      // here at all, asked once more for how.
      plainTextFile: activePath && resolveOpenAction(activePath) === "text" ? activePath : undefined,
      vaultPath: vaultPath || "",
      i18n,
      headerTexts: {
        addIcon: t("docHeader.addIcon"),
        addColor: t("docHeader.addColor"),
        changeIcon: t("docHeader.changeIcon"),
        changeColor: t("docHeader.changeColor"),
        statusDraft: t("docHeader.statusDraft"),
        statusDeprecated: t("docHeader.statusDeprecated"),
      },
      deps: sessionDepsRef,
    });
    sessionRef.current = session;
    session.setEditable(!workspaceReadOnly);
    // Seed the freshly created view with the current resolver set so unresolved
    // links style immediately instead of only after the next resolver bump.
    if (wikiResolverRef.current) session.view.dispatch({ effects: setWikiResolver.of(wikiResolverRef.current) });
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
  }, [isLoading, isReadMode, activePath, vaultPath, i18n.language, workspaceReadOnly]);

  useEffect(() => { sessionRef.current?.setEditable(!workspaceReadOnly); }, [workspaceReadOnly]);

  // Push the resolved ranges into the editor. An orphan contributes nothing -
  // its card says so instead; tinting a random place would be worse than none.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const highlights = [];
    for (const comment of workspaceComments) {
      if (comment.resolvedAt) continue;
      const resolution = anchorResolutions.get(comment.commentId);
      if (!resolution || resolution.status === "orphan") continue;
      highlights.push({ commentId: comment.commentId, from: resolution.from, to: resolution.to, active: comment.commentId === activeCommentId });
    }
    session.setAnchorHighlights(highlights);
  }, [workspaceComments, anchorResolutions, activeCommentId, viewMode, isLoading]);

  /**
   * Attaches a comment, minting the marker pair when the member may write.
   *
   * A comment-only member gets the SOFT anchor alone (quote plus context):
   * inserting markers would be a content write, which that capability does not
   * carry. Resolution stages 2 and 3 are built for exactly that case.
   */
  const postComment = useCallback(async (body: string, parentCommentId: string | null) => {
    if (!activePath) return;
    const view = sessionRef.current?.view;
    const range = view?.state.selection.main;
    // A reply belongs to its thread, not to a place: it inherits the root anchor.
    if (parentCommentId !== null || !view || !range || range.empty) {
      await postWorkspaceComment(activePath, body, parentCommentId, null);
      return;
    }
    const raw = view.state.doc.toString();
    const markerId = mintAnchorMarkerId(raw);
    const anchor = buildCommentAnchor(raw, range.from, range.to, markerId);
    if (!anchor.quote) { await postWorkspaceComment(activePath, body, null, null); return; }
    const marked = !workspaceReadOnly;
    if (marked) view.dispatch({ changes: [{ from: range.from, insert: openAnchorMarker(markerId) }, { from: range.to, insert: closeAnchorMarker(markerId) }] });
    try {
      await postWorkspaceComment(activePath, body, null, anchor);
    } catch (error) {
      // The markers were an act of writing. If the comment never reached the
      // workspace, the note must not keep a pair nothing points at.
      if (marked) {
        const current = sessionRef.current?.view;
        const found = current ? findAnchorMarker(current.state.doc.toString(), markerId) : null;
        if (current && found) current.dispatch({ changes: [{ from: found.from - openAnchorMarker(markerId).length, to: found.from }, { from: found.to, to: found.to + closeAnchorMarker(markerId).length }] });
      }
      throw error;
    }
  }, [activePath, postWorkspaceComment, workspaceReadOnly]);

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
      {workspaceReadOnly && <div className="pv-banner pv-banner--info">{workspaceCanComment ? t("workspaceSecurity.commentOnly", { defaultValue: "Comment-only access — file content is read-only." }) : t("workspaceSecurity.readOnly", { defaultValue: "Read-only access — changes cannot be saved." })}</div>}
      {!peek && (
      <div className="pv-appbar pv-appbar--split" data-testid="editor-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            onClick={onNavigateBack}
            disabled={!canGoBack}
            className="pv-iconbtn"
            aria-label={t("editor.back")} data-tip={t("editor.back")}
          >
            <ArrowLeft size={ICON.head} />
          </button>
          <button
            onClick={onNavigateForward}
            disabled={!canGoForward}
            className="pv-iconbtn"
            aria-label={t("editor.forward")} data-tip={t("editor.forward")}
          >
            <ArrowRight size={ICON.head} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "var(--text-ui)", color: saveError ? "var(--error-text)" : "var(--text-muted)" }} data-tip={saveError || ""}>
            {isSaving ? t("editor.saving") : saveError ? t("editor.saveFailed") : t("editor.saved")}
          </span>
          {!isPlainText && <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", padding: "2px" }}>
            <button
              onClick={() => { setViewMode('read'); rememberSessionViewMode(activePath, 'read'); }}
              aria-label={t("editor.readMode")} data-tip={t("editor.readMode")}
              className="pv-iconbtn"
              style={{ background: viewMode === 'read' ? 'var(--bg-primary)' : 'transparent', color: viewMode === 'read' ? 'var(--accent-color)' : 'var(--text-muted)', boxShadow: viewMode === 'read' ? 'var(--shadow-1)' : 'none' }}
            >
              <BookOpen size={ICON.ui} />
            </button>
            <button
              onClick={() => { if (!managedIndex) { setViewMode('live'); rememberSessionViewMode(activePath, 'live'); } }}
              aria-label={managedIndex ? t("indexMd.managedBanner") : t("editor.livePreview")} data-tip={managedIndex ? t("indexMd.managedBanner") : t("editor.livePreview")}
              className="pv-iconbtn"
              style={{ opacity: managedIndex ? 0.45 : 1, background: viewMode === 'live' ? 'var(--bg-primary)' : 'transparent', color: viewMode === 'live' ? 'var(--accent-color)' : 'var(--text-muted)', boxShadow: viewMode === 'live' ? 'var(--shadow-1)' : 'none' }}
            >
              <Pencil size={ICON.ui} />
            </button>
            <button
              onClick={() => { if (!managedIndex) { setViewMode('source'); rememberSessionViewMode(activePath, 'source'); } }}
              aria-label={managedIndex ? t("indexMd.managedBanner") : t("editor.sourceMode")} data-tip={managedIndex ? t("indexMd.managedBanner") : t("editor.sourceMode")}
              className="pv-iconbtn"
              style={{ opacity: managedIndex ? 0.45 : 1, background: viewMode === 'source' ? 'var(--bg-primary)' : 'transparent', color: viewMode === 'source' ? 'var(--accent-color)' : 'var(--text-muted)', boxShadow: viewMode === 'source' ? 'var(--shadow-1)' : 'none' }}
            >
              <Code size={ICON.ui} />
            </button>
          </div>}

          <button
            onClick={toggleWidth}
            data-tip={editorWidth === 'narrow' ? t("editor.widthFull", { defaultValue: "Volle Breite" }) : t("editor.widthNarrow", { defaultValue: "Lesbare Breite" })}
            aria-label={editorWidth === 'narrow' ? t("editor.widthFull", { defaultValue: "Volle Breite" }) : t("editor.widthNarrow", { defaultValue: "Lesbare Breite" })}
            className="pv-iconbtn"
          >
            {editorWidth === 'narrow' ? <UnfoldHorizontal size={ICON.ui} /> : <FoldHorizontal size={ICON.ui} />}
          </button>

          <SplitButton onSplit={onSplit} activeDirection={activeSplitDirection} />
          <div style={{ position: "relative" }}>
            <button
              ref={menuBtnRef}
              onClick={() => setShowMenu(!showMenu)}
              data-tip={t("editor.menu", { defaultValue: "Menu" })}
              aria-label={t("editor.menu", { defaultValue: "Menu" })}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              data-testid="editor-menu-btn"
              className="pv-iconbtn"
            >
              <MoreVertical size={ICON.ui} />
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
              <MenuItem icon={<Pencil size={ICON.ui} />} data-testid="editor-menu-rename" onSelect={() => { void handleMenuRename(); }}>
                {t("common.rename", { defaultValue: "Umbenennen" })}
              </MenuItem>
              <MenuItem icon={<Copy size={ICON.ui} />} onSelect={() => { void handleMenuDuplicate(); }}>
                {t("fileTree.duplicate")}
              </MenuItem>
              {isTemplateFile && (
                <MenuItem icon={<Database size={ICON.ui} />} data-testid="editor-menu-template-targets" onSelect={() => setShowTemplateTargets(true)}>
                  {t("editor.templateTargets", "Ziel-Datenbanken…")}
                </MenuItem>
              )}
              {onToggleBookmark && (
                <MenuItem icon={<Bookmark size={ICON.ui} fill={isBookmarked ? "currentColor" : "none"} />} onSelect={onToggleBookmark}>
                  {isBookmarked ? t("editor.removeBookmark", { defaultValue: "Lesezeichen entfernen" }) : t("editor.addBookmark", { defaultValue: "Lesezeichen hinzufügen" })}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                icon={<History size={ICON.ui} />}
                data-testid="editor-menu-version-history"
                onSelect={() => { if (activePath) window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: activePath } })); }}
              >
                {t("fileTree.versionHistory")}
              </MenuItem>
              <MenuItem icon={<ClipboardCopy size={ICON.ui} />} onSelect={() => { void handleMenuCopyPath(); }}>
                {t("fileTree.copyPath")}
              </MenuItem>
              <MenuItem icon={<FolderTree size={ICON.ui} />} data-testid="editor-menu-reveal-tree" onSelect={handleMenuRevealInTree}>
                {t("editor.revealInTree")}
              </MenuItem>
              {isOwnerWindow() && (
                <MenuItem icon={<ExternalLink size={ICON.ui} />} data-testid="editor-menu-new-window" onSelect={handleMenuOpenInNewWindow}>
                  {t("window.openInNewWindow")}
                </MenuItem>
              )}
              <MenuItem icon={<FolderOpen size={ICON.ui} />} onSelect={() => { void handleMenuReveal(); }}>
                {t("editor.revealInFileManager", "Im Dateimanager anzeigen")}
              </MenuItem>
              <MenuItem icon={<ExternalLink size={ICON.ui} />} onSelect={() => { void handleMenuOpenInDefaultApp(); }}>
                {t("editor.openInDefaultApp")}
              </MenuItem>
              <MenuSeparator />
              {/* Issue #56: dragging from the file manager used to be the only
                  way in, and nothing in the app said so. */}
              <MenuItem icon={<Paperclip size={ICON.ui} />} data-testid="editor-menu-attach-file" onSelect={() => { void attachFile(); }}>
                {t("editor.attachFile", { defaultValue: "Datei anhängen…" })}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Printer size={ICON.ui} />} onSelect={handleMenuPrint}>
                {t("editor.print")}
              </MenuItem>
              <MenuItem icon={<FileDown size={ICON.ui} />} onSelect={handleMenuExportMarkdown}>
                {t("editor.exportMarkdown", "Als Markdown exportieren…")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Mail size={ICON.ui} />} data-testid="editor-menu-send-mail" onSelect={handleMenuSendMail}>
                {t("mail.sendNoteViaEmail", { defaultValue: "Per Mail verschicken" })}
              </MenuItem>
              <MenuItem icon={<Paperclip size={ICON.ui} />} data-testid="editor-menu-send-mail-attachment" onSelect={handleMenuSendMailAttachment}>
                {t("mail.sendNoteAsAttachment", { defaultValue: "Per Mail als Anhang" })}
              </MenuItem>
              {onDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 size={ICON.ui} />} onSelect={onDelete}>
                    {t("editor.delete", { defaultValue: "Löschen" })}
                  </MenuItem>
                </>
              )}
            </MenuSurface>
          </div>
        </div>
      </div>
      )}

      {showTemplateTargets && activePath && (
        <TemplateTargetsModal templatePath={activePath} onClose={() => setShowTemplateTargets(false)} />
      )}

      {staleSince && (
        // OKF 0.2 `stale_after` (plan P3a, D3): display only — nothing is
        // written, nothing is blocked; the one action opens the properties.
        <div data-testid="okf-stale-banner">
          <Banner
            kind="warning"
            actions={
              <button
                type="button"
                className="pv-btn pv-btn--secondary pv-btn--sm"
                onClick={() => window.dispatchEvent(new CustomEvent("plainva-reveal-properties"))}
              >
                {t("trust.openProperties")}
              </button>
            }
          >
            {t("trust.staleBanner", { date: formatStampDate(staleSince, i18n.language) })}
          </Banner>
        </div>
      )}

      {conflictInfo && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-text)", fontSize: "var(--text-ui)" }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            {conflictInfo.conflictPath
              ? t("editor.conflictBanner", { path: conflictInfo.conflictPath })
              : t("editor.conflictBannerNoPath")}
          </span>
          {conflictInfo.conflictPath && (
            <button
              type="button"
              className="pv-btn pv-btn--secondary pv-btn--sm"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-resolve-conflict", { detail: { path: conflictInfo.conflictPath } }))}
            >
              {t("conflict.resolveAction")}
            </button>
          )}
          {conflictInfo.conflictPath && onOpenPath && (
            <button type="button" className="pv-btn pv-btn--secondary pv-btn--sm" onClick={() => onOpenPath(conflictInfo.conflictPath, true)}>
              {t("editor.conflictOpenCopy")}
            </button>
          )}
          <button type="button" className="pv-btn pv-btn--secondary pv-btn--sm" onClick={() => setConflictInfo(null)}>
            {t("common.dismiss")}
          </button>
        </div>
      )}

      {draftOffer && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-text)", fontSize: "var(--text-ui)" }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            {t("editor.draftBanner", { time: new Date(draftOffer.savedAt).toLocaleString() })}
          </span>
          <button
            type="button"
            className="pv-btn pv-btn--secondary pv-btn--sm"
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
            className="pv-btn pv-btn--secondary pv-btn--sm"
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

      <div className={workspaceCanReadComments ? "pv-comment-layout" : undefined} style={workspaceCanReadComments ? undefined : { display: "contents" }}>
      <div ref={readScrollRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: "var(--bg-primary)", overflowY: viewMode === 'read' ? "auto" : "hidden" }}>
        {viewMode === 'read' ? (
          <>
            {managedIndex && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 1rem", borderBottom: "1px solid var(--border-color)", background: "var(--bg-secondary)", fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
                <span style={{ flex: 1, minWidth: 180 }}>{t("indexMd.managedBanner")}</span>
                <button type="button" className="pv-btn pv-btn--secondary pv-btn--sm" onClick={() => void refreshManagedIndex()}>{t("indexMd.refreshNow")}</button>
                <button type="button" className="pv-btn pv-btn--secondary pv-btn--sm" onClick={() => void unlockManagedIndex()}>{t("indexMd.editAnyway")}</button>
              </div>
            )}
            <DocumentHeaderRead meta={docMeta} fullWidth={editorWidth === 'full'} badge={trustBadge} badgeTexts={badgeTexts} />
            <NoteDatabaseBar
              context={dbContext}
              title={activePath ? noteDisplayName(activePath) : ""}
              fullWidth={editorWidth === 'full'}
              onOpenPath={(p) => onOpenPath?.(p, false)}
            />
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
        ) : notText ? (
          // C15 (S13): the extension promised text, the bytes did not keep the
          // promise. Showing it anyway would mean holding a lossy decode and
          // writing that back on the first save — so the file is offered to
          // the system app instead, which knows what it is.
          <div data-testid="editor-not-text" style={{ padding: "2rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", textAlign: "center" }}>
            <FileX size={ICON.empty} style={{ color: "var(--text-faint)" }} />
            <strong style={{ fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("editor.notTextTitle")}</strong>
            <code style={{ fontSize: "var(--text-sm)" }}>{activePath}</code>
            <p style={{ margin: 0, fontSize: "var(--text-md)", maxWidth: "42ch" }}>{t("editor.notTextBody")}</p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
              <Button variant="primary" onClick={() => { void handleMenuOpenInDefaultApp(); }}>
                {t("editor.openInDefaultApp")}
              </Button>
              {onDelete && (
                <Button variant="secondary" onClick={onDelete}>
                  {t("editor.missingFileCloseTab")}
                </Button>
              )}
            </div>
          </div>
        ) : loadError ? (
          // Issue #34: phantom rows in a stale index (typically after a deletion
          // made outside Plainva) used to open an editor whose CONTENT was the
          // error message. The index entry is dropped right here, so the row
          // that led here disappears instead of luring the next click.
          <div data-testid="editor-missing-file" style={{ padding: "2rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", textAlign: "center" }}>
            <FileX size={ICON.empty} style={{ color: "var(--text-faint)" }} />
            <strong style={{ fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("editor.missingFileTitle")}</strong>
            <code style={{ fontSize: "var(--text-sm)" }}>{activePath}</code>
            <p style={{ margin: 0, fontSize: "var(--text-md)", maxWidth: "42ch" }}>{t("editor.missingFileBody")}</p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
              {onDelete && (
                <Button variant="primary" onClick={onDelete}>
                  {t("editor.missingFileCloseTab")}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  if (!indexer || !activePath) return;
                  void applyIndexChanges(indexer, { removed: [activePath] })
                    .then(() => triggerFileTreeUpdate([activePath]))
                    .catch(() => {});
                }}
              >
                {t("editor.missingFileRefresh")}
              </Button>
            </div>
          </div>
        ) : (
          // The editor session (P1/P2) mounts CodeMirror into this container;
          // React only ever touches the div's attributes, never the editor.
          // The database context line sits ABOVE it as a plain React sibling —
          // the editor container itself must stay untouched by React.
          <>
            <NoteDatabaseBar
              context={dbContext}
              title={activePath ? noteDisplayName(activePath) : ""}
              fullWidth={editorWidth === 'full'}
              onOpenPath={(p) => onOpenPath?.(p, false)}
            />
          <div
            ref={editorContainerRef}
            // Readable line length (#1): center the text column when narrow.
            className={editorWidth === 'narrow' ? 'pv-cm-narrow' : undefined}
            // No overflow here: CodeMirror's own .cm-scroller handles scrolling,
            // and the wrapper (above) is overflow:hidden in editor mode, so there
            // is exactly one scroll container per view — no nested scrollbars (#4).
            style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 'var(--content-font-size, 16px)' }}
          />
          </>
        )}
      </div>
      {workspaceCanReadComments && (
        <WorkspaceCommentsColumn
          comments={workspaceComments}
          memberNames={memberNames}
          resolutions={anchorResolutions}
          canComment={workspaceCanComment}
          activeCommentId={activeCommentId}
          selectionQuote={selectionQuote}
          onSelect={setActiveCommentId}
          onSubmit={postComment}
          onResolve={(commentId) => { if (activePath) void resolveWorkspaceComment(activePath, commentId).catch((error) => toast.error(error instanceof Error ? error.message : String(error))); }}
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
        <div
          className="pv-popover--fixed"
          style={{ left: dateMention.x, top: dateMention.y, minWidth: "180px", visibility: "visible" }}
        >
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
