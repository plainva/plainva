import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  Slash,
  Strikethrough,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  applyBlockAction,
  buildMarkdownTable,
  consumePendingSearchJump,
  createEditorSession,
  cycleHeading,
  findFirstMatch,
  insertWikiLink,
  openFindPanel,
  openSlashMenu,
  performBlockMove,
  planTableInsertion,
  redo,
  templateInsertText,
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
import { TemplatePickSheet } from "./components/TemplatePickSheet";
import { noteSaver, vaultOps, type MobileVault } from "./services/vaultService";
import { syncSoon } from "./services/syncService";

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
  const depsRef = useRef<EditorSessionDeps>(null as unknown as EditorSessionDeps);
  useLayoutEffect(() => {
    depsRef.current = {
      queryService: vault.queryService,
      vaultContext: null,
      hostPath: path,
      onOpenPath: (p) => onOpenNote(p),
      openWikiTarget: (target) => {
        void vaultOps.resolveWikiTarget(vault, target).then((resolved) => {
          if (resolved) onOpenNote(resolved);
        });
      },
      openExternalUrl: (url) => {
        window.open(url, "_blank", "noopener");
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
      onPickIcon: () => {},
      onPickColor: () => {},
      readBinaryFile: (absolutePath) =>
        vault.adapter.readBinaryFile(absolutePath.replace(/^\/+/, "")),
      buildNoteEmbedExtension: () => [],
    };
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const session = createEditorSession({
      parent,
      doc: initialDoc,
      mode: "live",
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
    });
    sessionRef.current = session;
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
    return () => {
      // The coordinator already owns the pending text — flush it now; the
      // write survives this unmount (it is not tied to component lifetime).
      void noteSaver.flush(path);
      sessionRef.current = null;
      session.destroy();
    };
    // initialDoc is the load-time snapshot for THIS path — remount on path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, t]);

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
    window.addEventListener("m-editor-goto-line", onGoto);
    window.addEventListener("m-editor-set-mode", onSetMode);
    window.addEventListener("m-editor-find", onFind);
    return () => {
      window.removeEventListener("m-editor-goto-line", onGoto);
      window.removeEventListener("m-editor-set-mode", onSetMode);
      window.removeEventListener("m-editor-find", onFind);
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
      const view = sessionRef.current?.view;
      if (!view || at === null) return;
      const pos = Math.min(at, view.state.doc.length);
      const stem = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
      const text = templateInsertText(raw, stem);
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
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
        <div aria-label={t("mobile.editToolbar")} className="m-edit-toolbar" role="toolbar">
          <button aria-label="Slash commands" onClick={() => run(openSlashMenu)}>
            <Slash size={18} />
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
        </div>
      )}

      {tableSheet && (
        <div className="m-sheet-backdrop" onClick={() => setTableSheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
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
