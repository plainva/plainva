import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import {
  createEditorSession,
  type EditorSession,
  type EditorSessionDeps,
} from "@plainva/ui";
import { memoryVault } from "./vault/memoryVault";

/**
 * Mounts the SHARED CodeMirror session (@plainva/ui, ADR 0011) against the
 * M1 in-memory vault — the "Hello Vault" proof. Same deps-ref pattern as the
 * desktop Editor; the shell capabilities are browser stubs until M2.
 */
export function EditorHost({
  path,
  onOpenNote,
}: {
  path: string;
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
        const resolved = memoryVault.resolveWikiTarget(target);
        if (resolved) onOpenNote(resolved);
      },
      openExternalUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      handlePaste: () => false,
      handleDrop: () => false,
      onDocChanged: (view) => {
        memoryVault.save(path, view.state.doc.toString());
      },
      onSelectionToolbar: () => {},
      onSelectionStats: () => {},
      onPickIcon: () => {},
      onPickColor: () => {},
      readBinaryFile: async () => new Uint8Array(),
      buildNoteEmbedExtension: () => [],
    };
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const session = createEditorSession({
      parent,
      doc: memoryVault.read(path),
      mode: "live",
      vaultPath: "/",
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
  }, [path, t]);

  return <div className="m-editor" ref={containerRef} />;
}
