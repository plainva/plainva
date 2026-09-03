import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SheetGrip } from "./components/SheetGrip";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import {
  Bold,
  Camera as CameraIcon,
  CheckSquare,
  ChevronsDownUp,
  Database as DatabaseIcon,
  Copy,
  Heading,
  Italic,
  Link2,
  List,
  Minus,
  MoveDown,
  MoveUp,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Undo2,
} from "lucide-react";
import { applySelectionFormat, isVaultPathLink, type AnchorFrameHint, type AnchorHighlight, baseEmbedText, createInlineBase, folderOf, resolveOpenAction, SelectionToolbar, planPaste, importAttachment, errorText, useStableHandler, applyBlockAction, type BlockAction, type BlockTarget, buildDailyNotePath, buildMarkdownTable, buildNoteEmbedCoreExtension, buildWikiTargetSet, Button, Chip, consumePendingSearchJump, consumePendingTemplateCaret, createEditorSession, cycleHeading, deleteColumn, deleteRow, DockedToolbar, type EditorSession, type EditorSessionDeps, findFirstMatch, getPlatformServices, ICON, IconButton, insertColumn, insertRow, insertWikiLink, markdownToPlainText, openFindPanel, openSlashMenu, parseMarkdownTable, performBlockMove, planTableInsertion, redo, serializeTable, setColumnAlign, setWikiResolver, type TemplateItem, TextInput, toggleInlineMark, toggleLinePrefix, undo } from "@plainva/ui";
import { Camera, MediaTypeSelection } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY, setFrontmatterPath } from "@plainva/core";
import { EMBED_ROWS, scopedEmbedRows } from "./services/baseOps";
import { ColorPickSheet } from "./components/ColorPickSheet";
import { EmojiPickSheet } from "./components/EmojiPickSheet";
import { TableMenuSheet, type TableMenuAction } from "./components/TableMenuSheet";
import { TemplatePickSheet } from "./components/TemplatePickSheet";
import {
  getLastPersistedText,
  noteSaver,
  rememberPersistedText,
  vaultOps,
  type MobileVault,
} from "./services/vaultService";
import { Banner, conflictCopyPath, decideDirtyExternalUpdate, toast } from "@plainva/ui";
import { getConflict, noteConflict, subscribeConflicts } from "./services/conflictState";
import { ConflictCompareSheet } from "./components/ConflictCompareSheet";
import { syncSoon } from "./services/syncService";
import { mConfirm, mSelect } from "./services/mobileDialogs";
import { applyTemplateInteractive } from "./services/templateInteractive";
import { setEditorSelectionReader } from "./services/editorSelection";
import { getMobileSettings } from "./services/mobileSettings";
import { getActiveVaultEntry } from "./services/vaultRegistry";
import { availablePhotoPath, cameraErrorMessage, isCameraCancellation, mediaResultBytes } from "./services/photoCapture";
import { pickDeviceFiles } from "./services/pickFiles";
import { recallScrollTop, rememberScrollTop } from "@plainva/ui";

/**
 * Mounts the SHARED CodeMirror session (@plainva/ui, ADR 0011) against the
 * sandbox vault (M2). Same deps-ref pattern as the desktop Editor; saves are
 * write-through plus an incremental index update. M4: notes open READ-ONLY
 * (contentEditable off — live preview stays fully rendered) and editing
 * adds a fixed keyboard toolbar with the shared touch commands.
 */
export function EditorHost({
  vault,
  path,
  initialDoc,
  onOpenNote,
  editable,
  canComment,
  onCommentAnchorRequest,
  anchorHighlights,
}: {
  vault: MobileVault;
  path: string;
  initialDoc: string;
  onOpenNote: (path: string) => void;
  editable: boolean;
  /** Stufe E (E1): this note accepts comments, so widgets offer the affordance. */
  canComment?: boolean;
  /** A widget was asked to be commented on. The screen owns the comment sheet. */
  onCommentAnchorRequest?: (req: { from: number; to: number; display: AnchorFrameHint }) => void;
  /**
   * Stufe E (E4): resolved comment ranges to tint and frame.
   *
   * The screen owns the comments, so it owns the resolution too; the host only
   * pushes the result into the session. `sessionRef` is internal, which is why
   * this arrives as a prop rather than the screen reaching for the view.
   */
  anchorHighlights?: readonly AnchorHighlight[];
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const highlightsRef = useRef<readonly AnchorHighlight[]>([]);
  const editableRef = useRef(editable);
  // Block-handle menu (R1.2): the grip tap dispatches a window event (shared
  // blockHandles plugin); this host renders it as a bottom sheet.
  const [blockMenuFrom, setBlockMenuFrom] = useState<number | null>(null);
  // S5: the conflict banner's state lives outside this component, so closing
  // and reopening the note does not make an unresolved conflict disappear.
  const conflict = useSyncExternalStore(subscribeConflicts, () => getConflict(path));
  const [conflictDiff, setConflictDiff] = useState(false);
  // Slash-command sheets (R3.4): the shared plugin fires the same picker
  // events as on the desktop; this host renders them as bottom sheets.
  const [tableSheet, setTableSheet] = useState<{ pos: number } | null>(null);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [templatePick, setTemplatePick] = useState<{ pos: number } | null>(null);
  // C3: cell long-press menu of the live table widget + the @-mention date pick.
  const [tableMenu, setTableMenu] = useState<{
    from: number;
    to: number;
    kind: "header" | "body";
    rowIndex: number;
    colIndex: number;
  } | null>(null);
  const [dateMention, setDateMention] = useState<{ pos: number } | null>(null);
  const [dateValue, setDateValue] = useState("");
  // C3: emoji sheet serves both text emoji (/emoji) and the document icon
  // (header widget + /icon); the color sheet drives plainva.header_color.
  const [emojiPick, setEmojiPick] = useState<"emoji" | "icon" | null>(null);
  // What the selection contains (S17). The editor also reports WHERE it is;
  // that position becomes the selection toolbar in S18, so it is not stored
  // here yet — state nothing reads is the thing this redesign keeps deleting.
  const [selectionStats, setSelectionStats] = useState<{ chars: number; words: number } | null>(null);
  // Where the selection sits, so the formatting toolbar can stand over it
  // (S18). The same component the desktop uses — six actions, one definition.
  const [selectionAt, setSelectionAt] = useState<{ x: number; y: number; above: boolean } | null>(null);
  // The .base picker of the insert menu (S19): the slash entry existed and
  // did nothing, because it fires an event only the desktop listened to.
  const [basePick, setBasePick] = useState<{ pos: number } | null>(null);
  /** A `.csv` or `.py` opened as text (C15, S14) — not a note. */
  const isPlainText = resolveOpenAction(path) === "text";
  /**
   * Whether the docked formatting bar is on screen. It is `position: fixed`
   * at the bottom edge, so the editor has to end above it — but ONLY while
   * it is there. The reserve used to be unconditional, which left a dead
   * strip of `--m-docked-h` under every note in read mode and under every
   * plain-text file (maintainer finding 2026-08-24: content cut off at the
   * bottom). One flag decides both the bar and its reserve, so the two can
   * no longer drift apart.
   */
  const showEditToolbar = editable && !isPlainText;
  const [bases, setBases] = useState<{ path: string; title: string }[]>([]);
  const [colorPick, setColorPick] = useState(false);
  /**
   * A pasted, dropped or picked file (S17, issue #55): stored in the vault's
   * attachment folder and referenced at the caret — the same destination a
   * photo goes to, so a screenshot pasted here and a photo taken there end up
   * together.
   *
   * It used to be images only, and it showed in two ways that made anything
   * else unusable: every file was renamed `Image-<stamp>.<ext>` (a PDF included)
   * and every reference was written as an EMBED, which draws a broken image for
   * a document. Now the name comes from the file when it has one — a clipboard
   * bitmap does not, and only then does the timestamp step in — and only images
   * get `![[…]]`. This is the desktop's rule; it just never reached the phone.
   */
  const importFileAtCaret = useStableHandler(async (file: File, at: number) => {
    try {
      const { insert } = await importAttachment(
        { name: file.name || "", mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
        {
          configuredFolder: getMobileSettings().attachmentFolder,
          // Falls back to "beside the note" when the setting is empty, which is
          // what the shared helper documents. The phone used to pass "" here,
          // so an empty setting dropped attachments in the vault root instead.
          noteFolder: folderOf(path),
        },
        {
          exists: (c) => vault.files.exists(c),
          createDir: (dir) => vault.files.createDir(dir),
          writeBinaryFile: (p, bytes) => vault.files.writeBinaryFile(p, bytes),
        },
      );
      const view = sessionRef.current?.view;
      if (view) {
        const pos = Math.min(at, view.state.doc.length);
        view.dispatch({
          changes: { from: pos, insert },
          selection: { anchor: pos + insert.length },
          userEvent: "input",
        });
      }
      syncSoon();
    } catch (error) {
      console.error("[EditorHost] importing a file failed", error);
      toast.error(t("mobile.fileInsertFailed", {
        defaultValue: "The file could not be added: {{error}}",
        error: errorText(error),
      }));
    }
  });

  const depsRef = useRef<EditorSessionDeps>(null as unknown as EditorSessionDeps);
  useLayoutEffect(() => {
    depsRef.current = {
      queryService: vault.queryService,
      vaultContext: null,
      hostPath: path,
      // Stufe E (E4): without these two the selection bubble is INERT on the
      // phone - the shared session asks the deps whether anchors are on, and a
      // missing getter reads as "off". `canComment` already carries the same
      // condition the desktop feeds its widgets (capability plus the per-vault
      // setting), so the affordance appears in exactly the same places.
      commentAnchorsEnabled: () => canComment === true && getMobileSettings().commentAnchors,
      onCommentAnchorRequest: (req) => onCommentAnchorRequest?.(req),
      onOpenPath: (p) => onOpenNote(p),
      openWikiTarget: (target, _newTab, kind) => {
        void vaultOps.resolveWikiTarget(vault, target, path).then(async (resolved) => {
          if (resolved) { onOpenNote(resolved); return; }
          // A relative markdown link is a PATH, and a path that resolves to
          // nothing is a missing file — not an invitation to create a note
          // named after it (issue #61: `../_resources/x.mp3` gained a `.md` on
          // the desktop and hit the vault guard). Creating stays reserved for
          // unresolved WIKI links.
          if (kind === "markdown" && isVaultPathLink(target)) {
            toast.warning(i18n.t("dialogs.linkNotFoundMsg", { target }));
            return;
          }
          // Target note doesn't exist yet — create it (Obsidian parity,
          // maintainer 2026-07-18), then open. Since S39 the phone honours the
          // same "ask first" setting as the desktop; default off, so the
          // established behaviour is unchanged for anyone who never sets it.
          if (getMobileSettings().askBeforeCreateLink) {
            const ok = await mConfirm({
              title: t("settings.askBeforeCreateLink"),
              message: target,
            });
            if (!ok) return;
          }
          const created = await vaultOps.createNoteFromWikiTarget(vault, target, path);
          if (created) onOpenNote(created);
        });
      },
      openExternalUrl: (url) => {
        // Route external URLs (table-cell / embed links) through platform
        // services (@capacitor/browser). window.open does NOT reliably reach
        // the system browser inside the native WebView (see main.tsx).
        void getPlatformServices().openExternal(url);
      },
      // Smart paste (S17): an image on the clipboard becomes an attachment
      // plus an embed, a bare URL over a selection becomes a link around it.
      // The DECISION is shared with the desktop; only the storing differs.
      handlePaste: (event, view) => {
        const cd = event.clipboardData;
        if (!cd) return false;
        const sel = view.state.selection.main;
        const plan = planPaste(Array.from(cd.files || []), cd.getData("text/plain"), {
          empty: sel.empty,
          text: view.state.sliceDoc(sel.from, sel.to),
        });
        if (plan.kind === "file") {
          event.preventDefault();
          void importFileAtCaret(plan.file, sel.head);
          return true;
        }
        if (plan.kind === "link") {
          event.preventDefault();
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: plan.insert },
            selection: { anchor: sel.from + plan.insert.length },
            userEvent: "input",
          });
          return true;
        }
        return false;
      },
      // A drop carries files on Android too (a share into the WebView, a
      // file-manager drag in split screen). Same treatment as a pasted file;
      // anything without files falls through to CodeMirror's own text drop.
      // Any type, like the desktop: dropping is meaningless on a phone but not
      // on a tablet in split screen, and two rules for one gesture are harder
      // to explain than one.
      handleDrop: (event, view) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void (async () => {
          for (const file of files) await importFileAtCaret(file, pos);
        })();
        return true;
      },
      onDocChanged: (view) => {
        // Save coordinator (hardening P2, finding M1): the pending text now
        // lives OUTSIDE this component — single-flight, latest-write-wins,
        // retry on failure, flushed on background/vault switch. The old
        // fire-and-forget dropped the text before the write confirmed.
        noteSaver.schedule(vault, path, view.state.doc.toString());
      },
      onSelectionToolbar: (at) => setSelectionAt(at),
      onSelectionStats: (stats) => setSelectionStats(stats),
      // C3: the header widget's icon/stripe buttons open the mobile sheets.
      onPickIcon: () => setEmojiPick("icon"),
      onPickColor: () => setColorPick(true),
      readBinaryFile: (absolutePath) =>
        vault.adapter.readBinaryFile(absolutePath.replace(/^\/+/, "")),
      // Note embeds (package H): the shared CM core scans ![[...]] lines;
      // mobile renders a tappable preview card — note text stripped to
      // plain prose, .base as a database card, both opening their target.
      buildNoteEmbedExtension: (_ctx, isLive) =>
        buildNoteEmbedCoreExtension(
          {
            render: (container, target) => {
              let stale = false;
              container.classList.add("m-embed");
              void (async () => {
                const bare = target.split("#")[0].split("|")[0].trim();
                let resolved: string | null = null;
                for (const cand of [bare, `${bare}.md`, `${bare}.base`]) {
                  if (await vault.files.exists(cand)) {
                    resolved = cand;
                    break;
                  }
                }
                if (!resolved) resolved = await vaultOps.resolveWikiTarget(vault, bare, path);
                if (stale) return;
                const card = document.createElement("button");
                card.type = "button";
                card.className = "pv-card pv-card--embed m-embed-card";
                if (!resolved) {
                  card.classList.add("is-missing");
                  card.textContent = `![[${target}]]`;
                  container.appendChild(card);
                  return;
                }
                const path0 = resolved;
                const head = document.createElement("span");
                head.className = "m-embed-title";
                head.textContent = path0.split("/").pop()!.replace(/\.(md|base)$/i, "");
                card.appendChild(head);
                if (!/\.base$/i.test(path0)) {
                  try {
                    const text = await vaultOps.read(vault, path0);
                    if (stale) return;
                    const body = document.createElement("span");
                    body.className = "m-embed-body";
                    body.textContent = markdownToPlainText(
                      text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""),
                    ).slice(0, 280);
                    card.appendChild(body);
                  } catch {
                    /* preview stays title-only */
                  }
                } else {
                  card.classList.add("is-base");
                  // An embedded database shows ITS rows for THIS note (S23):
                  // the project note lists its tasks. The scope is the shared
                  // one the desktop uses — automatic when the two bases are
                  // related, plus any explicit "this note" filter.
                  try {
                    const rows = await scopedEmbedRows(vault, path0, path);
                    if (stale) return;
                    for (const r of rows.slice(0, EMBED_ROWS)) {
                      const line = document.createElement("button");
                      line.className = "m-embed-row";
                      line.textContent = r.title;
                      line.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        onOpenNote(r.path);
                      });
                      card.appendChild(line);
                    }
                    if (rows.length > EMBED_ROWS) {
                      const more = document.createElement("span");
                      more.className = "m-embed-more";
                      more.textContent = `+${rows.length - EMBED_ROWS}`;
                      card.appendChild(more);
                    }
                  } catch {
                    /* an unreadable base stays a plain card */
                  }
                }
                card.addEventListener("click", () => onOpenNote(path0));
                container.appendChild(card);
              })();
              return () => {
                stale = true;
              };
            },
          },
          isLive,
        ),
    };
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const session = createEditorSession({
      parent,
      doc: initialDoc,
      mode: "live",
      // Same rule as the desktop (C15, S14): a `.csv` is text, not a note, and
      // the two shells must not disagree about what it IS.
      plainTextFile: resolveOpenAction(path) === "text" ? path : undefined,
      // The ＋ Icon/＋ Farbstreifen buttons live in the note ⋮ menu on mobile.
      headerAddActions: false,
      vaultPath: "",
      i18n,
      headerTexts: {
        addIcon: t("docHeader.addIcon"),
        addColor: t("docHeader.addColor"),
        changeIcon: t("docHeader.changeIcon"),
        changeColor: t("docHeader.changeColor"),
        statusDraft: t("docHeader.statusDraft"),
        statusDeprecated: t("docHeader.statusDeprecated"),
      },
      deps: depsRef,
      // Read-first (M4): the session's editable facet blocks input for real —
      // flipping the raw contenteditable attribute was rewritten by CM on the
      // next update, so a tap re-opened the keyboard (finding 2026-07-11).
      editable: editableRef.current,
      // Native selection handles + virtual-keyboard smartness (2026-07-16).
      touchInput: true,
    });
    sessionRef.current = session;
    // Where you were (feedback round 2026-09-01, A5/E7): the scroll position
    // per file, device-local, restored once the view has laid the document
    // out, and remembered on the way out and while scrolling.
    const remembered = recallScrollTop(vault.vaultId, path);
    if (remembered !== null) {
      requestAnimationFrame(() => {
        if (sessionRef.current === session) session.view.scrollDOM.scrollTop = remembered;
      });
    }
    let scrollTimer: number | null = null;
    const onScroll = () => {
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null;
        rememberScrollTop(vault.vaultId, path, session.view.scrollDOM.scrollTop);
      }, 400);
    };
    session.view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    // A fresh session starts blank, so the frames have to be re-applied here -
    // the effect below only fires when the LIST changes, and remounting the
    // host (key change on note switch) does not change it.
    session.setAnchorHighlights(highlightsRef.current);
    // {{selection}} in a template reads from HERE (plan Vorlagen-Engine P6):
    // the reader is registered, never the text — see editorSelection.ts.
    setEditorSelectionReader(() => {
      const view = sessionRef.current?.view;
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      return from === to ? null : view.state.sliceDoc(from, to);
    });
    // Unresolved-link styling (maintainer 2026-07-18): push the set of existing
    // targets into the shared wiki plugin so links to not-yet-created notes read
    // muted (dashed). Same field the desktop editor feeds.
    void vault.queryService?.getDocumentTitles().then((map) => {
      if (sessionRef.current?.view !== session.view) return;
      const files: { title: string; path: string }[] = [];
      map.forEach((v, p) => files.push({ title: v.title, path: p }));
      session.view.dispatch({ effects: setWikiResolver.of(buildWikiTargetSet(files)) });
    }).catch(() => {});
    // The load-time snapshot IS the persisted disk state for this path (the
    // rare draft-restore case self-corrects on the first save). Needed by the
    // external-update guard below to tell our own echo from foreign content.
    rememberPersistedText(path, initialDoc);
    // Search jump (P4): a parked jump from the search tab selects and
    // reveals the first occurrence once the session exists (rAF so the
    // first layout pass has happened before scrolling).
    const jump = consumePendingSearchJump(path);
    if (jump) {
      requestAnimationFrame(() => {
        const view = sessionRef.current?.view;
        if (!view) return;
        const m = findFirstMatch(view.state.doc.toString(), jump.term);
        if (m) {
          view.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true });
        }
      });
    }
    // {{cursor}} of a template a note was just created from (plan
    // Vorlagen-Engine P6). Same park-store as the desktop: the note is written
    // and opened before this editor exists, so the offset waits here.
    const caret = consumePendingTemplateCaret(path);
    if (caret) {
      requestAnimationFrame(() => {
        const view = sessionRef.current?.view;
        if (!view) return;
        const at = Math.min(caret.offset, view.state.doc.length);
        view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      });
    }

    // External-update guard (2026-07-16, desktop 3e parity): a sync pull or
    // auto-merge that rewrote THIS note used to be ignored entirely — the
    // events were dispatched but nobody listened, so the next debounced save
    // silently overwrote the foreign version, and the worker's reconcile
    // preserved a stale typing-pause snapshot as .CONFLICT instead.
    const handleExternalUpdate = async () => {
      const s = sessionRef.current;
      if (!s) return;
      let disk: string;
      try {
        disk = await vaultOps.read(vault, path);
      } catch {
        return; // deleted/renamed under us; the tree refresh handles that
      }
      const draft = s.view.state.doc.toString();
      const lastPersisted = getLastPersistedText(path);
      const dirty =
        noteSaver.hasPending(path) || (lastPersisted !== null && draft !== lastPersisted);
      if (!dirty) {
        // Clean buffer: realign to whatever reached the disk.
        if (disk !== draft) {
          s.applyExternalText(disk);
          rememberPersistedText(path, disk);
        }
        return;
      }
      const action = decideDirtyExternalUpdate({ disk, draft, lastPersisted });
      if (action === "realign") {
        rememberPersistedText(path, disk);
        return;
      }
      if (action === "own-echo") return; // our own save came back; keep typing
      // preserve-conflict: a genuinely different version is on disk. Preserve
      // the draft as a .CONFLICT sibling, adopt the disk version and drop the
      // queued save (it would overwrite the foreign version right back).
      noteSaver.discard(path);
      const copyPath = conflictCopyPath(path);
      try {
        await vault.files.writeTextFile(copyPath, draft);
      } catch (e) {
        console.error("[EditorHost] preserving conflict copy failed", e);
        // Nothing was preserved, so a banner pointing at a copy would lie.
        toast.error(t("mobile.conflictPreserveFailed"));
        sessionRef.current?.applyExternalText(disk);
        rememberPersistedText(path, disk);
        return;
      }
      sessionRef.current?.applyExternalText(disk);
      rememberPersistedText(path, disk);
      // S5: the same end state as a failed save — the user's text is beside
      // the note and they need a way to it. A toast said so and then left.
      noteConflict(path, copyPath);
    };
    const onExternalUpdate = (ev: Event) => {
      if ((ev as CustomEvent).detail?.path !== path) return;
      void handleExternalUpdate();
    };
    const onAutoMerged = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { path?: string; mergedText?: string } | undefined;
      if (d?.path !== path || typeof d.mergedText !== "string") return;
      // Our save was 3-way-merged with a concurrent disk change. A clean
      // buffer adopts the merge result; a dirty one keeps typing — its next
      // save runs through the same merge chain and converges.
      if (!noteSaver.hasPending(path)) {
        sessionRef.current?.applyExternalText(d.mergedText);
        rememberPersistedText(path, d.mergedText);
      }
    };
    window.addEventListener("m-external-update", onExternalUpdate);
    window.addEventListener("m-auto-merged", onAutoMerged);

    return () => {
      window.removeEventListener("m-external-update", onExternalUpdate);
      window.removeEventListener("m-auto-merged", onAutoMerged);
      // The coordinator already owns the pending text — flush it now; the
      // write survives this unmount (it is not tied to component lifetime).
      void noteSaver.flush(path);
      setEditorSelectionReader(null);
      session.view.scrollDOM.removeEventListener("scroll", onScroll);
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      rememberScrollTop(vault.vaultId, path, session.view.scrollDOM.scrollTop);
      sessionRef.current = null;
      session.destroy();
    };
    // initialDoc is the load-time snapshot for THIS path — remount on path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, t]);

  // C3: the shared live-preview widgets dispatch these; only one editor is
  // ever mounted on mobile, so the events need no path guard.
  useEffect(() => {
    const onTableMenu = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        from: number;
        to: number;
        kind: "header" | "body";
        rowIndex: number;
        colIndex: number;
      };
      setTableMenu({ from: d.from, to: d.to, kind: d.kind, rowIndex: d.rowIndex, colIndex: d.colIndex });
    };
    const onDateMention = (e: Event) => {
      const pos = ((e as CustomEvent).detail as { pos?: number } | undefined)?.pos;
      if (pos == null) return;
      setDateValue(new Date().toISOString().slice(0, 10));
      setDateMention({ pos });
    };
    const onEmoji = () => setEmojiPick("emoji");
    const onIcon = () => setEmojiPick("icon");
    const onColor = () => setColorPick(true);
    // The slash command shares its event with the desktop (issue #56). Without
    // a listener here the entry would render and do nothing — which is why the
    // shell declares such gaps in slashSupport rather than shipping a dead row.
    const onAttachFile = () => {
      const at = sessionRef.current?.view.state.selection.main.head;
      if (at === undefined) return;
      void (async () => {
        for (const file of await pickDeviceFiles()) await importFileAtCaret(file, at);
      })();
    };
    window.addEventListener("plainva-open-table-menu", onTableMenu);
    window.addEventListener("plainva-open-date-mention", onDateMention);
    window.addEventListener("plainva-open-emoji-picker", onEmoji);
    window.addEventListener("plainva-open-icon-picker", onIcon);
    window.addEventListener("plainva-open-header-color", onColor);
    window.addEventListener("plainva-attach-file", onAttachFile);
    return () => {
      window.removeEventListener("plainva-open-table-menu", onTableMenu);
      window.removeEventListener("plainva-open-date-mention", onDateMention);
      window.removeEventListener("plainva-open-emoji-picker", onEmoji);
      window.removeEventListener("plainva-open-icon-picker", onIcon);
      window.removeEventListener("plainva-open-header-color", onColor);
      window.removeEventListener("plainva-attach-file", onAttachFile);
    };
  }, [importFileAtCaret]);

  // Desktop applyPlainvaValue/applyDocIcon contract: rewrite the plainva:
  // frontmatter namespace on the live document (emoji icons clear a stale
  // icon_color, exactly like the desktop's emoji pick).
  const applyPlainva = (mutate: (base: string) => string) => {
    const view = sessionRef.current?.view;
    if (!view) return;
    try {
      const base = view.state.doc.toString();
      const next = mutate(base);
      if (next !== base) {
        // Deliberately NO userEvent: the shared frontmatterProtectPlugin
        // rejects user-initiated ("input") changes inside the frontmatter —
        // this programmatic metadata write must pass the filter (the desktop
        // properties path dispatches the same way).
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      }
    } catch (e) {
      console.warn("[EditorHost] updating plainva frontmatter failed", e);
    }
  };

  const handleEmojiPick = (char: string, color?: string | null) => {
    const mode = emojiPick;
    setEmojiPick(null);
    const view = sessionRef.current?.view;
    if (!view) return;
    if (mode === "emoji") {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: char },
        selection: { anchor: range.from + char.length },
        userEvent: "input",
      });
      view.focus();
    } else {
      // An icon may carry a tint (P4.2). Without one the stale colour is
      // cleared, exactly as the desktop's pick does.
      applyPlainva((base) => {
        const withIcon = setFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "icon"], char);
        return color
          ? setFrontmatterPath(withIcon, [PLAINVA_NAMESPACE_KEY, "icon_color"], color)
          : deleteFrontmatterPath(withIcon, [PLAINVA_NAMESPACE_KEY, "icon_color"]);
      });
    }
  };

  // Desktop handleTableMenuAction contract: re-parse the table from the live
  // document (source of truth), run the shared mutation, write the slice back.
  const handleTableAction = (action: TableMenuAction) => {
    const view = sessionRef.current?.view;
    if (view && tableMenu) {
      const { from, to, kind, rowIndex, colIndex } = tableMenu;
      const safeTo = Math.min(to, view.state.doc.length);
      // The cell is the table's comment affordance - a widget click carries no
      // text selection, so the menu hands the range and the coordinates over.
      if (action === "cell-comment") {
        onCommentAnchorRequest?.({ from, to: safeTo, display: { kind: "tableCell", row: kind === "header" ? 0 : rowIndex + 1, column: colIndex } });
        setTableMenu(null);
        return;
      }
      if (action === "table-delete") {
        let end = safeTo;
        if (end < view.state.doc.length && view.state.sliceDoc(end, end + 1) === "\n") end++;
        view.dispatch({ changes: { from, to: end, insert: "" }, userEvent: "input" });
      } else {
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
        }
      }
    }
    setTableMenu(null);
  };

  // Desktop handleDateMentionSelect contract: insert @YYYY-MM-DD at the caret.
  const insertMentionDate = () => {
    const view = sessionRef.current?.view;
    if (view && dateMention && dateValue) {
      const pos = Math.min(dateMention.pos, view.state.doc.length);
      const token = `@${dateValue}`;
      view.dispatch({
        changes: { from: pos, insert: token },
        selection: { anchor: pos + token.length },
        userEvent: "input",
      });
      view.focus();
    }
    setDateMention(null);
  };

  // Context-sheet requests (C1/C4): outline jump, mode toggle, in-note search.
  useEffect(() => {
    const forThisNote = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      const view = sessionRef.current?.view;
      return view && detail?.path === path ? { view, detail: detail as Record<string, unknown> } : null;
    };
    const onGoto = (e: Event) => {
      const hit = forThisNote(e);
      const line = hit && (hit.detail.line as number | undefined);
      if (!hit || !line) return;
      const l = hit.view.state.doc.line(Math.min(Math.max(line, 1), hit.view.state.doc.lines));
      hit.view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
    };
    /**
     * Jump to a comment's passage (Stufe D, D6).
     *
     * The sheet has already resolved the anchor against the CURRENT text and
     * hands over offsets - resolving here would mean a second, possibly
     * different answer for the same anchor. Selecting rather than only
     * scrolling is deliberate: on a phone the passage has to be findable
     * without a mouse pointer to trace it.
     */
    const onGotoRange = (e: Event) => {
      const hit = forThisNote(e);
      if (!hit) return;
      const len = hit.view.state.doc.length;
      const from = Math.min(Math.max((hit.detail.from as number | undefined) ?? -1, 0), len);
      const to = Math.min(Math.max((hit.detail.to as number | undefined) ?? -1, from), len);
      if (from === to) return;
      hit.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    };
    const onSetMode = (e: Event) => {
      const hit = forThisNote(e);
      const mode = hit && (hit.detail.mode as "live" | "source" | undefined);
      if (hit && mode) sessionRef.current?.setMode(mode);
    };
    const onFind = (e: Event) => {
      const hit = forThisNote(e);
      if (hit) openFindPanel(hit.view);
    };
    // Note ⋮ menu (mockup 2): icon / stripe pickers open from outside.
    const onPickIcon = (e: Event) => {
      if (forThisNote(e)) setEmojiPick("icon");
    };
    const onPickColor = (e: Event) => {
      if (forThisNote(e)) setColorPick(true);
    };
    window.addEventListener("m-editor-goto-line", onGoto);
    window.addEventListener("m-editor-goto-range", onGotoRange);
    window.addEventListener("m-editor-set-mode", onSetMode);
    window.addEventListener("m-editor-find", onFind);
    window.addEventListener("m-editor-pick-icon", onPickIcon);
    window.addEventListener("m-editor-pick-color", onPickColor);
    return () => {
      window.removeEventListener("m-editor-goto-line", onGoto);
      window.removeEventListener("m-editor-goto-range", onGotoRange);
      window.removeEventListener("m-editor-set-mode", onSetMode);
      window.removeEventListener("m-editor-find", onFind);
      window.removeEventListener("m-editor-pick-icon", onPickIcon);
      window.removeEventListener("m-editor-pick-color", onPickColor);
    };
  }, [path]);

  // Read-first (M4): the editable facet keeps the live preview fully
  // rendered while blocking the keyboard; entering edit mode focuses.
  useEffect(() => {
    editableRef.current = editable;
    const session = sessionRef.current;
    if (!session) return;
    session.setEditable(editable);
    if (editable) {
      // An untouched caret sits at 0 — inside the hidden frontmatter, where
      // typing (and the slash menu) would land invisibly. Start at the end.
      const view = session.view;
      const sel = view.state.selection.main;
      if (sel.empty && sel.head === 0) {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
      view.focus();
    }
  }, [editable]);

  // Stufe E (E4): push the resolved ranges into the session. The screen resolves
  // them (it owns the comments); an orphan never reaches here, because tinting a
  // random place would be worse than tinting none.
  useEffect(() => {
    /* The ref is written HERE, not during render: a session that is rebuilt
       without the host remounting reads it at mount and would otherwise start
       blank. On the very first mount this effect runs right after that one, so
       an empty read is corrected a tick later. */
    highlightsRef.current = anchorHighlights ?? [];
    sessionRef.current?.setAnchorHighlights(anchorHighlights ?? []);
  }, [anchorHighlights]);

  useEffect(() => {
    const onConflict = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: EditorSession["view"] }>).detail;
      if (detail?.view !== sessionRef.current?.view) return;
      toast.info(t("editor.blockFormatConflict", { defaultValue: "A line cannot be both a heading and a task. Use bold for a prominent task title." }));
    };
    window.addEventListener("plainva-editor-block-format-conflict", onConflict);
    return () => window.removeEventListener("plainva-editor-block-format-conflict", onConflict);
  }, [t]);

  // Block-handle events (R1.2): the shared plugin dispatches window events;
  // the desktop editor listens too, but only one shell is ever mounted.
  useEffect(() => {
    const onMenu = (e: Event) => {
      if (!sessionRef.current) return;
      const d = (e as CustomEvent).detail as { from: number };
      setBlockMenuFrom(d.from);
    };
    const onMove = (e: Event) => {
      const view = sessionRef.current?.view;
      if (!view) return;
      const d = (e as CustomEvent).detail as { from: number; targetFrom: number };
      performBlockMove(view, d.from, d.targetFrom);
    };
    window.addEventListener("plainva-open-block-menu", onMenu);
    window.addEventListener("plainva-move-block", onMove);
    // Slash pickers (R3.4): "table" and "insert template" clear the typed
    // /query and hand over the insert position through these events.
    const onTablePicker = (e: Event) => {
      if (!sessionRef.current) return;
      const pos = (e as CustomEvent).detail?.pos;
      setTableRows(3);
      setTableCols(3);
      setTableSheet({ pos: typeof pos === "number" ? pos : sessionRef.current.view.state.selection.main.head });
    };
    const onTemplatePicker = (e: Event) => {
      if (!sessionRef.current) return;
      const pos = (e as CustomEvent).detail?.pos;
      setTemplatePick({ pos: typeof pos === "number" ? pos : sessionRef.current.view.state.selection.main.head });
    };
    window.addEventListener("plainva-open-table-picker", onTablePicker);
    window.addEventListener("plainva-open-template-picker", onTemplatePicker);
    return () => {
      window.removeEventListener("plainva-open-block-menu", onMenu);
      window.removeEventListener("plainva-move-block", onMove);
      window.removeEventListener("plainva-open-table-picker", onTablePicker);
      window.removeEventListener("plainva-open-template-picker", onTemplatePicker);
    };
  }, []);

  const runBlockAction = (action: BlockAction) => {
    const view = sessionRef.current?.view;
    const from = blockMenuFrom;
    setBlockMenuFrom(null);
    if (view && from !== null) applyBlockAction(view, from, action);
  };

  const run = (fn: (v: NonNullable<EditorSession["view"]>) => unknown) => {
    const view = sessionRef.current?.view;
    if (view) fn(view);
  };

  // GFM table at the picked position (desktop handleTableSelect logic — the
  // shared widget renders it as soon as the caret lands past the block).
  const insertTable = () => {
    const view = sessionRef.current?.view;
    const at = tableSheet?.pos ?? null;
    setTableSheet(null);
    if (!view || at === null) return;
    const docLen = view.state.doc.length;
    const pos = Math.min(at, docLen);
    const built = buildMarkdownTable(tableRows, tableCols, t("editor.tableColumn", { defaultValue: "Spalte" }));
    const prev = pos >= 1 ? view.state.sliceDoc(pos - 1, pos) : "";
    const prevPrev = pos >= 2 ? view.state.sliceDoc(pos - 2, pos - 1) : "";
    const next = pos < docLen ? view.state.sliceDoc(pos, pos + 1) : "";
    const nextNext = pos + 1 < docLen ? view.state.sliceDoc(pos + 1, pos + 2) : "";
    const { insert, caretOffset } = planTableInsertion(built.text, prev, prevPrev, next, nextNext);
    view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: Math.min(pos + caretOffset, docLen + insert.length) },
      userEvent: "input",
    });
    view.focus();
  };

  // Insert a template's body at the picked position: frontmatter stripped,
  // placeholders interpolated against THIS note, questions asked in one sheet.
  const insertTemplate = (item: TemplateItem) => {
    const at = templatePick?.pos ?? null;
    setTemplatePick(null);
    void (async () => {
      const raw = await vaultOps.read(vault, item.path);
      const stem = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
      // The template's own frontmatter would be inert garbage mid-document, so
      // it is stripped. Every question is asked in ONE sheet (plan
      // Vorlagen-Engine P6) — the old loop asked one prompt per placeholder,
      // and cancelling the third left the first two answered with no way back.
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      const ms = getMobileSettings();
      const answered = await applyTemplateInteractive(body, {
        title: stem,
        now: new Date(),
        folder: path.split("/").slice(0, -1).join("/"),
        vaultName: (await getActiveVaultEntry()).name || "Plainva",
        hostPath: path,
        dailyPath: (offset) => {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          return buildDailyNotePath(d, ms.dailyFormat, ms.dailyFolder).fullPath.replace(/\.md$/i, "");
        },
      });
      if (!answered) return; // cancelled → nothing is inserted
      const { text, cursor } = answered;
      const view = sessionRef.current?.view;
      if (!view || at === null) return;
      const pos = Math.min(at, view.state.doc.length);
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + (cursor ?? text.length) },
        userEvent: "input",
      });
      view.focus();
    })();
  };

  /** Inserts the embed snippet for a `.base` at a position (S19). */
  const embedBaseAt = (basePath: string, pos: number) => {
    const view = sessionRef.current?.view;
    if (!view) return;
    const at = Math.min(pos, view.state.doc.length);
    const text = baseEmbedText(basePath);
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: "input",
    });
  };

  // The two insert-menu entries that were dead on the phone (S19). Both write
  // the same file the desktop writes — the shared helper, not a second one.
  useEffect(() => {
    const openPicker = (e: Event) => {
      const pos = (e as CustomEvent).detail?.pos ?? 0;
      void vault.queryService?.listBases().then((rows) => {
        setBases(rows);
        setBasePick({ pos });
      }).catch(() => setBasePick({ pos }));
    };
    const createBase = (e: Event) => {
      const pos = (e as CustomEvent).detail?.pos ?? 0;
      void (async () => {
        try {
          const folder = folderOf(path);
          const created = await createInlineBase(
            vault.adapter,
            folder,
            t("editor.inlineBaseDefaultName", { defaultValue: "Datenbank" }),
            t("database.viewTable", { defaultValue: "Table" }),
          );
          await vault.indexer?.indexPath(created);
          embedBaseAt(created, pos);
          syncSoon();
        } catch (error) {
          console.error("[EditorHost] creating an inline base failed", error);
        }
      })();
    };
    window.addEventListener("plainva-open-base-picker", openPicker);
    window.addEventListener("plainva-create-inline-base", createBase);
    return () => {
      window.removeEventListener("plainva-open-base-picker", openPicker);
      window.removeEventListener("plainva-create-inline-base", createBase);
    };
  });

  // P2: camera/gallery photo lands as an attachment in the vault and embeds
  // at the cursor; the queueing chain syncs it like any other file.
  //
  // Issue #56 adds a third way: a file from the device. That is why the sheet
  // is no longer titled "Add photo" — a photo was all it could do. The picker
  // is a plain <input type="file">, the same one the import wizard uses: on
  // Android and iOS that IS the system document picker, and it needs no new
  // native dependency. AttachPickSheet was not an option — it deliberately
  // searches the VAULT, so it can only offer what is already inside.
  const insertPhoto = () => {
    const insertAt = sessionRef.current?.view.state.selection.main.head;
    if (insertAt === undefined) return;
    void (async () => {
      const source = await mSelect({
        title: t("mobile.insertSource", { defaultValue: "Insert" }),
        options: [
          { value: "camera", label: t("mobile.takePhoto", { defaultValue: "Take photo" }) },
          { value: "gallery", label: t("mobile.choosePhoto", { defaultValue: "Choose from library" }) },
          { value: "file", label: t("mobile.pickFile", { defaultValue: "File from device…" }) },
        ],
        value: "camera",
      });
      if (!source) return;
      if (source === "file") {
        // No cancel EVENT exists for a file input on either platform, so an
        // empty selection IS the dismissal (see importService).
        for (const file of await pickDeviceFiles()) await importFileAtCaret(file, insertAt);
        return;
      }
      try {
        const photo = source === "camera"
          ? await Camera.takePhoto({ quality: 85, includeMetadata: true })
          : (await Camera.chooseFromGallery({
              mediaType: MediaTypeSelection.Photo,
              allowMultipleSelection: false,
              includeMetadata: true,
              quality: 85,
            })).results[0];
        if (!photo) return;
        const bytes = await mediaResultBytes(photo, (uri) => Filesystem.readFile({ path: uri }));
        const name = await availablePhotoPath((candidate) => vault.files.exists(candidate), photo);
        await vault.files.writeBinaryFile(name, bytes);
        run((view) => {
          const pos = Math.min(insertAt, view.state.doc.length);
          const embed = `![[${name}]]`;
          view.dispatch({
            changes: { from: pos, insert: embed },
            selection: { anchor: pos + embed.length },
            userEvent: "input",
          });
          view.focus();
        });
        syncSoon();
      } catch (error) {
        if (isCameraCancellation(error)) return;
        console.error("[EditorHost] inserting a photo failed", error);
        toast.error(t("mobile.photoInsertFailed", {
          defaultValue: "The photo could not be added: {{error}}",
          error: cameraErrorMessage(error),
        }));
      }
    })();
  };

  return (
    <>
      {/* S5: a conflict is an END STATE, so it stays on screen until the user
          acts on it. It used to be a toast — one per retry round, each round
          writing another .CONFLICT file that no surface pointed at. The two
          ways out are the two questions anyone has here: where is my text, and
          what is different. */}
      {conflict && (
        <Banner
          actions={
            <>
              <Button onClick={() => onOpenNote(conflict.copyPath)} variant="ghost">
                {t("mobile.conflictOpenCopy")}
              </Button>
              <Button onClick={() => setConflictDiff(true)} variant="ghost">
                {t("mobile.conflictShowDiff")}
              </Button>
            </>
          }
          kind="warning"
          rounded
        >
          <b>{t("mobile.conflictTitle")}</b>
          <br />
          {t("mobile.conflictBody")}
          <br />
          <code>{conflict.copyPath}</code>
        </Banner>
      )}
      <div className={`m-editor${showEditToolbar ? " is-docked" : ""}`} ref={containerRef} />
      {/* The formatting toolbar over a selection (S18). It was desktop-only,
          so on a phone the six most common formats needed the docked toolbar
          and a second look away from the text. */}
      {editable && selectionAt && (
        <SelectionToolbar
          above={selectionAt.above}
          onAction={(action) => {
            const view = sessionRef.current?.view;
            if (!view) return;
            applySelectionFormat(view, action, () => toast.info(t("editor.fmtMultilineLink")));
          }}
          x={selectionAt.x}
          y={selectionAt.y}
        />
      )}
      {/* What is selected, where the editor reports it (S17). The desktop says
          this in the status bar; the phone has no status bar, and the toolbar
          is where the eye already is while editing. */}
      {/* Text files (C15, S14) get no markdown toolbar: bold and a slash menu on
          a `.csv` are actions its file type cannot carry. Selection counts stay
          — those are about text, not about Markdown. */}
      {editable && (
        <>
        {selectionStats && (
          <p className="m-selstats">
            {/* The desktop's own words, already translated ten times over. */}
            {selectionStats.words} {t("statusbar.words")} · {selectionStats.chars}{" "}
            {t("statusbar.chars")}
          </p>
        )}
        {showEditToolbar && <DockedToolbar aria-label={t("mobile.editToolbar")} className="m-edit-toolbar">
          {/* Insert menu (slash commands) sits FIRST and reads as a ＋ — the
              trailing "/" glyph was unintuitive (maintainer feedback). */}
          <button aria-label={t("mobile.insertMenu")} className="is-primary" onClick={() => run(openSlashMenu)}>
            <Plus size={ICON.head} />
          </button>
          <button aria-label={t("editor.fmtBold")} onClick={() => run((v) => toggleInlineMark(v, "**"))}>
            <Bold size={ICON.head} />
          </button>
          <button aria-label={t("editor.fmtItalic")} onClick={() => run((v) => toggleInlineMark(v, "*"))}>
            <Italic size={ICON.head} />
          </button>
          <button aria-label={t("editor.fmtStrike")} onClick={() => run((v) => toggleInlineMark(v, "~~"))}>
            <Strikethrough size={ICON.head} />
          </button>
          <button aria-label={t("editor.fmtHeading")} onClick={() => run(cycleHeading)}>
            <Heading size={ICON.head} />
          </button>
          <button aria-label={t("editor.slashBulletList")} onClick={() => run((v) => toggleLinePrefix(v, "- "))}>
            <List size={ICON.head} />
          </button>
          <button aria-label={t("editor.slashCheckbox")} onClick={() => run((v) => toggleLinePrefix(v, "- [ ] "))}>
            <CheckSquare size={ICON.head} />
          </button>
          <button aria-label={t("editor.slashQuote")} onClick={() => run((v) => toggleLinePrefix(v, "> "))}>
            <Quote size={ICON.head} />
          </button>
          <button aria-label={t("editor.slashWikiLink")} onClick={() => run(insertWikiLink)}>
            <Link2 size={ICON.head} />
          </button>
          <button aria-label={t("mobile.photoSource")} onClick={insertPhoto}>
            <CameraIcon size={ICON.head} />
          </button>
          <button aria-label={t("common.undo")} onClick={() => run(undo)}>
            <Undo2 size={ICON.head} />
          </button>
          <button aria-label={t("common.redo")} onClick={() => run(redo)}>
            <Redo2 size={ICON.head} />
          </button>
        </DockedToolbar>}
        </>
      )}

      {/* S5: "what is different" — the same read-only diff the browser shows
          for a conflict copy, so there is one definition of that answer. */}
      {conflict && conflictDiff && (
        <ConflictCompareSheet
          vault={vault}
          conflictPath={conflict.copyPath}
          originalPath={path}
          onClose={() => setConflictDiff(false)}
          onResolved={() => setConflictDiff(false)}
        />
      )}
      {tableSheet && (
        <div className="m-sheet-backdrop" onClick={() => setTableSheet(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setTableSheet(null)} />
            <p className="m-sheet-title">{t("editor.slashTable")}</p>
            <Stepper
              label={t("mobile.tableCols")}
              onChange={setTableCols}
              value={tableCols}
            />
            <Stepper
              label={t("mobile.tableRows")}
              onChange={setTableRows}
              value={tableRows}
            />
            <div className="m-btnrow">
              <Button variant="ghost" onClick={() => setTableSheet(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={insertTable}>
                {t("mobile.insert")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {tableMenu && <TableMenuSheet canComment={canComment} onAction={handleTableAction} onClose={() => setTableMenu(null)} />}

      {emojiPick && (
        <EmojiPickSheet
          onClose={() => setEmojiPick(null)}
          onPick={handleEmojiPick}
          onRemove={
            emojiPick === "icon"
              ? () => {
                  setEmojiPick(null);
                  applyPlainva((base) =>
                    deleteFrontmatterPath(
                      deleteFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "icon"]),
                      [PLAINVA_NAMESPACE_KEY, "icon_color"],
                    ),
                  );
                }
              : undefined
          }
          showRemove={emojiPick === "icon"}
          title={emojiPick === "icon" ? t("docHeader.addIcon") : t("editor.slashEmoji")}
        />
      )}

      {colorPick && (
        <ColorPickSheet
          onClose={() => setColorPick(false)}
          onPick={(hex) => {
            setColorPick(false);
            applyPlainva((base) => setFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "header_color"], hex));
          }}
          onRemove={() => {
            setColorPick(false);
            applyPlainva((base) => deleteFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "header_color"]));
          }}
        />
      )}

      {dateMention && (
        <div className="m-sheet-backdrop" onClick={() => setDateMention(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setDateMention(null)} />
            <p className="m-sheet-title">{t("editor.atDatePick")}</p>
            <div className="m-field">
              <TextInput onChange={(e) => setDateValue(e.target.value)} type="date" value={dateValue} />
            </div>
            <div className="m-btnrow">
              <Button variant="ghost" onClick={() => setDateMention(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={insertMentionDate}>
                {t("mobile.insert")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {templatePick && (
        <TemplatePickSheet
          onClose={() => setTemplatePick(null)}
          onPick={insertTemplate}
          title={t("editor.slashTemplate")}
          vault={vault}
        />
      )}

      {basePick && (
        <div className="m-sheet-backdrop" onClick={() => setBasePick(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setBasePick(null)} />
            <p className="m-sheet-title">{t("editor.slashEmbedBase")}</p>
            {bases.length === 0 ? (
              <p className="m-hint">{t("sidebar.noDatabases")}</p>
            ) : (
              bases.map((b) => (
                <button
                  className="m-row"
                  key={b.path}
                  onClick={() => {
                    const at = basePick.pos;
                    setBasePick(null);
                    embedBaseAt(b.path, at);
                  }}
                >
                  <DatabaseIcon size={ICON.head} />
                  <span className="m-row-txt">
                    <b>{b.title}</b>
                    <span>{b.path}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {blockMenuFrom !== null && (
        <div className="m-sheet-backdrop" onClick={() => setBlockMenuFrom(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="m-sheet-title">{t("block.menuTitle")}</p>
            <p className="m-sectionlabel">{t("block.turnInto")}</p>
            <div className="m-turninto">
              {(
                [
                  ["paragraph", t("block.paragraph")],
                  ["h1", t("block.h1")],
                  ["h2", t("block.h2")],
                  ["h3", t("block.h3")],
                  ["bullet", t("block.bullet")],
                  ["numbered", t("block.numbered")],
                  ["task", t("block.task")],
                  ["quote", t("block.quote")],
                  ["code", t("block.code")],
                ] as Array<[BlockTarget, string]>
              ).map(([target, label]) => (
                <Chip key={target} onClick={() => runBlockAction({ kind: "turn", target })}>
                  {label}
                </Chip>
              ))}
            </div>
            <button className="m-row" onClick={() => runBlockAction({ kind: "move-up" })}>
              <MoveUp size={ICON.ui} />
              <span>{t("block.moveUp")}</span>
            </button>
            <button className="m-row" onClick={() => runBlockAction({ kind: "move-down" })}>
              <MoveDown size={ICON.ui} />
              <span>{t("block.moveDown")}</span>
            </button>
            {/* Folding has existed since #10, but only through a keymap — on a
                phone that means never. It belongs where the block's other
                actions already are (S18). */}
            <button className="m-row" onClick={() => runBlockAction({ kind: "fold" })}>
              <ChevronsDownUp size={ICON.ui} />
              <span>{t("block.fold")}</span>
            </button>
            <button className="m-row" onClick={() => runBlockAction({ kind: "duplicate" })}>
              <Copy size={ICON.ui} />
              <span>{t("block.duplicate")}</span>
            </button>
            <button className="m-row m-danger" onClick={() => runBlockAction({ kind: "delete" })}>
              <Trash2 size={ICON.ui} />
              <span>{t("block.delete")}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Row/column count control of the table sheet (1–10). */
function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="m-row m-row--static">
      <span>{label}</span>
      <span className="m-stepper">
        <IconButton label={`${label} −`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
          <Minus size={ICON.head} />
        </IconButton>
        <span className="m-stepper-num">{value}</span>
        <IconButton label={`${label} +`} disabled={value >= 10} onClick={() => onChange(value + 1)}>
          <Plus size={ICON.head} />
        </IconButton>
      </span>
    </div>
  );
}
