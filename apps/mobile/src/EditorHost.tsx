import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import {
  Bold,
  Camera as CameraIcon,
  CheckSquare,
  Heading,
  Italic,
  Link2,
  List,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import {
  createEditorSession,
  cycleHeading,
  insertWikiLink,
  redo,
  toggleInlineMark,
  toggleLinePrefix,
  undo,
  type EditorSession,
  type EditorSessionDeps,
} from "@plainva/ui";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { vaultOps, type MobileVault } from "./services/vaultService";
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
  // Debounced save (desktop parity: not on every keystroke) with an unmount
  // flush so leaving the note never loses the last edit.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextRef = useRef<string | null>(null);
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
        pendingTextRef.current = view.state.doc.toString();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const text = pendingTextRef.current;
          pendingTextRef.current = null;
          if (text !== null) {
            void vaultOps.save(vault, path, text).then(() => syncSoon());
          }
        }, 800);
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
    });
    sessionRef.current = session;
    session.view.contentDOM.setAttribute("contenteditable", editableRef.current ? "true" : "false");
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const text = pendingTextRef.current;
      pendingTextRef.current = null;
      if (text !== null) {
        void vaultOps.save(vault, path, text).then(() => syncSoon());
      }
      sessionRef.current = null;
      session.destroy();
    };
    // initialDoc is the load-time snapshot for THIS path — remount on path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, t]);

  // Read-first (M4): flipping contentEditable keeps the live preview fully
  // rendered while blocking the keyboard; entering edit mode focuses.
  useEffect(() => {
    editableRef.current = editable;
    const view = sessionRef.current?.view;
    if (!view) return;
    view.contentDOM.setAttribute("contenteditable", editable ? "true" : "false");
    if (editable) view.focus();
  }, [editable]);

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
    </>
  );
}
