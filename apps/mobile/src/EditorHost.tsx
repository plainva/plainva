import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import {
  createEditorSession,
  type EditorSession,
  type EditorSessionDeps,
} from "@plainva/ui";
import { vaultOps, type MobileVault } from "./services/vaultService";

/**
 * Mounts the SHARED CodeMirror session (@plainva/ui, ADR 0011) against the
 * sandbox vault (M2). Same deps-ref pattern as the desktop Editor; saves are
 * write-through plus an incremental index update.
 */
export function EditorHost({
  vault,
  path,
  initialDoc,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  initialDoc: string;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const depsRef = useRef<EditorSessionDeps>(null as unknown as EditorSessionDeps);
  useLayoutEffect(() => {
    depsRef.current = {
      queryService: null,
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
        void vaultOps.save(vault, path, view.state.doc.toString());
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
    return () => {
      sessionRef.current = null;
      session.destroy();
    };
    // initialDoc is the load-time snapshot for THIS path — remount on path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, t]);

  return <div className="m-editor" ref={containerRef} />;
}
