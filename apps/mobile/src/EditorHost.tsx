import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SheetGrip } from "./components/SheetGrip";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import {
  Bold,
  Camera as CameraIcon,
  CheckSquare,
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
import {
  markdownToPlainText,
  getPlatformServices,
  buildNoteEmbedCoreExtension,
  applyBlockAction,
  buildMarkdownTable,
  buildWikiTargetSet,
  consumePendingSearchJump,
  createEditorSession,
  cycleHeading,
  deleteColumn,
  deleteRow,
  DockedToolbar,
  findFirstMatch,
  insertColumn,
  insertRow,
  insertWikiLink,
  openFindPanel,
  openSlashMenu,
  parseMarkdownTable,
  performBlockMove,
  planTableInsertion,
  redo,
  serializeTable,
  setColumnAlign,
  setWikiResolver,
  interpolateTemplateBody,
  extractTemplatePrompts,
  finalizeTemplate,
  toggleInlineMark,
  toggleLinePrefix,
  undo,
  type BlockAction,
  type BlockTarget,
  type EditorSession,
  type EditorSessionDeps,
  type TemplateItem,
} from "@plainva/ui";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { deleteFrontmatterPath, PLAINVA_NAMESPACE_KEY, setFrontmatterPath } from "@plainva/core";
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
import { conflictCopyPath, decideDirtyExternalUpdate, toast } from "@plainva/ui";
import { syncSoon } from "./services/syncService";
import { mPrompt } from "./services/mobileDialogs";

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
}: {
  vault: MobileVault;
  path: string;
  initialDoc: string;
  onOpenNote: (path: string) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const editableRef = useRef(editable);
  // Block-handle menu (R1.2): the grip tap dispatches a window event (shared
  // blockHandles plugin); this host renders it as a bottom sheet.
  const [blockMenuFrom, setBlockMenuFrom] = useState<number | null>(null);
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
  const [colorPick, setColorPick] = useState(false);
  const depsRef = useRef<EditorSessionDeps>(null as unknown as EditorSessionDeps);
  useLayoutEffect(() => {
    depsRef.current = {
      queryService: vault.queryService,
      vaultContext: null,
      hostPath: path,
      onOpenPath: (p) => onOpenNote(p),
      openWikiTarget: (target) => {
        void vaultOps.resolveWikiTarget(vault, target, path).then(async (resolved) => {
          if (resolved) { onOpenNote(resolved); return; }
          // Target note doesn't exist yet — create it (Obsidian parity,
          // maintainer 2026-07-18), then open. Mobile always creates
          // immediately (the "ask first" toggle is desktop-only for now).
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
      handlePaste: () => false,
      handleDrop: () => false,
      onDocChanged: (view) => {
        // Save coordinator (hardening P2, finding M1): the pending text now
        // lives OUTSIDE this component — single-flight, latest-write-wins,
        // retry on failure, flushed on background/vault switch. The old
        // fire-and-forget dropped the text before the write confirmed.
        noteSaver.schedule(vault, path, view.state.doc.toString());
      },
      onSelectionToolbar: () => {},
      onSelectionStats: () => {},
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
                card.className = "m-embed-card";
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
      // The ＋ Icon/＋ Farbstreifen buttons live in the note ⋮ menu on mobile.
      headerAddActions: false,
      vaultPath: "",
      i18n,
      headerTexts: {
        addIcon: t("docHeader.addIcon"),
        addColor: t("docHeader.addColor"),
        changeIcon: t("docHeader.changeIcon"),
        changeColor: t("docHeader.changeColor"),
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
      try {
        await vault.files.writeTextFile(conflictCopyPath(path), draft);
      } catch (e) {
        console.error("[EditorHost] preserving conflict copy failed", e);
      }
      sessionRef.current?.applyExternalText(disk);
      rememberPersistedText(path, disk);
      toast.warning(t("mobile.conflictPreserved"));
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
    window.addEventListener("plainva-open-table-menu", onTableMenu);
    window.addEventListener("plainva-open-date-mention", onDateMention);
    window.addEventListener("plainva-open-emoji-picker", onEmoji);
    window.addEventListener("plainva-open-icon-picker", onIcon);
    window.addEventListener("plainva-open-header-color", onColor);
    return () => {
      window.removeEventListener("plainva-open-table-menu", onTableMenu);
      window.removeEventListener("plainva-open-date-mention", onDateMention);
      window.removeEventListener("plainva-open-emoji-picker", onEmoji);
      window.removeEventListener("plainva-open-icon-picker", onIcon);
      window.removeEventListener("plainva-open-header-color", onColor);
    };
  }, []);

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

  const handleEmojiPick = (char: string) => {
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
      applyPlainva((base) =>
        deleteFrontmatterPath(
          setFrontmatterPath(base, [PLAINVA_NAMESPACE_KEY, "icon"], char),
          [PLAINVA_NAMESPACE_KEY, "icon_color"],
        ),
      );
    }
  };

  // Desktop handleTableMenuAction contract: re-parse the table from the live
  // document (source of truth), run the shared mutation, write the slice back.
  const handleTableAction = (action: TableMenuAction) => {
    const view = sessionRef.current?.view;
    if (view && tableMenu) {
      const { from, to, kind, rowIndex, colIndex } = tableMenu;
      const safeTo = Math.min(to, view.state.doc.length);
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
    window.addEventListener("m-editor-set-mode", onSetMode);
    window.addEventListener("m-editor-find", onFind);
    window.addEventListener("m-editor-pick-icon", onPickIcon);
    window.addEventListener("m-editor-pick-color", onPickColor);
    return () => {
      window.removeEventListener("m-editor-goto-line", onGoto);
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
  // {{title}} interpolated with THIS note's name (shared templateInsertText).
  const insertTemplate = (item: TemplateItem) => {
    const at = templatePick?.pos ?? null;
    setTemplatePick(null);
    void (async () => {
      const raw = await vaultOps.read(vault, item.path);
      const stem = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
      // Interpolate the body, then ask for {{prompt:…}} values and resolve the
      // {{cursor}} caret before inserting.
      const body = interpolateTemplateBody(raw, stem);
      const answers: Record<string, string> = {};
      for (const label of extractTemplatePrompts(body)) {
        const { value, cancelled } = await mPrompt({ title: label });
        if (cancelled) return;
        answers[label] = value ?? "";
      }
      const { text, cursor } = finalizeTemplate(body, answers);
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

  // P2: camera/gallery photo lands as an attachment in the vault and embeds
  // at the cursor; the queueing chain syncs it like any other file.
  const insertPhoto = () => {
    void (async () => {
      let photo;
      try {
        photo = await Camera.getPhoto({
          resultType: CameraResultType.Base64,
          source: CameraSource.Prompt,
          quality: 85,
        });
      } catch {
        return; // user cancelled the picker
      }
      const b64 = photo.base64String;
      if (!b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const name = `Attachments/Foto-${stamp}.${photo.format || "jpeg"}`;
      await vault.files.writeBinaryFile(name, bytes);
      run((view) => {
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: `![[${name}]]` },
          userEvent: "input",
        });
      });
      syncSoon();
    })();
  };

  return (
    <>
      <div className="m-editor" ref={containerRef} />
      {editable && (
        <DockedToolbar aria-label={t("mobile.editToolbar")} className="m-edit-toolbar">
          {/* Insert menu (slash commands) sits FIRST and reads as a ＋ — the
              trailing "/" glyph was unintuitive (maintainer feedback). */}
          <button aria-label={t("mobile.insertMenu")} className="is-primary" onClick={() => run(openSlashMenu)}>
            <Plus size={18} />
          </button>
          <button aria-label="Bold" onClick={() => run((v) => toggleInlineMark(v, "**"))}>
            <Bold size={18} />
          </button>
          <button aria-label="Italic" onClick={() => run((v) => toggleInlineMark(v, "*"))}>
            <Italic size={18} />
          </button>
          <button aria-label="Strikethrough" onClick={() => run((v) => toggleInlineMark(v, "~~"))}>
            <Strikethrough size={18} />
          </button>
          <button aria-label="Heading" onClick={() => run(cycleHeading)}>
            <Heading size={18} />
          </button>
          <button aria-label="List" onClick={() => run((v) => toggleLinePrefix(v, "- "))}>
            <List size={18} />
          </button>
          <button aria-label="Task" onClick={() => run((v) => toggleLinePrefix(v, "- [ ] "))}>
            <CheckSquare size={18} />
          </button>
          <button aria-label="Quote" onClick={() => run((v) => toggleLinePrefix(v, "> "))}>
            <Quote size={18} />
          </button>
          <button aria-label="Wiki link" onClick={() => run(insertWikiLink)}>
            <Link2 size={18} />
          </button>
          <button aria-label="Photo" onClick={insertPhoto}>
            <CameraIcon size={18} />
          </button>
          <button aria-label="Undo" onClick={() => run(undo)}>
            <Undo2 size={18} />
          </button>
          <button aria-label="Redo" onClick={() => run(redo)}>
            <Redo2 size={18} />
          </button>
        </DockedToolbar>
      )}

      {tableSheet && (
        <div className="m-sheet-backdrop" onClick={() => setTableSheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
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
              <button className="m-btn" onClick={() => setTableSheet(null)}>
                {t("common.cancel")}
              </button>
              <button className="m-btn m-btn--filled" onClick={insertTable}>
                {t("mobile.insert")}
              </button>
            </div>
          </div>
        </div>
      )}

      {tableMenu && <TableMenuSheet onAction={handleTableAction} onClose={() => setTableMenu(null)} />}

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
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setDateMention(null)} />
            <p className="m-sheet-title">{t("editor.atDatePick")}</p>
            <div className="m-field">
              <input onChange={(e) => setDateValue(e.target.value)} type="date" value={dateValue} />
            </div>
            <div className="m-btnrow">
              <button className="m-btn" onClick={() => setDateMention(null)}>
                {t("common.cancel")}
              </button>
              <button className="m-btn m-btn--filled" onClick={insertMentionDate}>
                {t("mobile.insert")}
              </button>
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

      {blockMenuFrom !== null && (
        <div className="m-sheet-backdrop" onClick={() => setBlockMenuFrom(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
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
                <button
                  className="m-chip"
                  key={target}
                  onClick={() => runBlockAction({ kind: "turn", target })}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="m-row" onClick={() => runBlockAction({ kind: "move-up" })}>
              <MoveUp size={16} />
              <span>{t("block.moveUp")}</span>
            </button>
            <button className="m-row" onClick={() => runBlockAction({ kind: "move-down" })}>
              <MoveDown size={16} />
              <span>{t("block.moveDown")}</span>
            </button>
            <button className="m-row" onClick={() => runBlockAction({ kind: "duplicate" })}>
              <Copy size={16} />
              <span>{t("block.duplicate")}</span>
            </button>
            <button className="m-row m-danger" onClick={() => runBlockAction({ kind: "delete" })}>
              <Trash2 size={16} />
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
        <button
          aria-label={`${label} −`}
          className="m-iconbtn"
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={18} />
        </button>
        <span className="m-stepper-num">{value}</span>
        <button
          aria-label={`${label} +`}
          className="m-iconbtn"
          disabled={value >= 10}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={18} />
        </button>
      </span>
    </div>
  );
}
