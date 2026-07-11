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
  MoveDown,
  MoveUp,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  applyBlockAction,
  consumePendingSearchJump,
  createEditorSession,
  cycleHeading,
  findFirstMatch,
  insertWikiLink,
  performBlockMove,
  redo,
  toggleInlineMark,
  toggleLinePrefix,
  undo,
  type BlockAction,
  type BlockTarget,
  type EditorSession,
  type EditorSessionDeps,
} from "@plainva/ui";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
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

  // Read-first (M4): the editable facet keeps the live preview fully
  // rendered while blocking the keyboard; entering edit mode focuses.
  useEffect(() => {
    editableRef.current = editable;
    const session = sessionRef.current;
    if (!session) return;
    session.setEditable(editable);
    if (editable) session.view.focus();
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
    return () => {
      window.removeEventListener("plainva-open-block-menu", onMenu);
      window.removeEventListener("plainva-move-block", onMove);
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
