import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Check, ChevronLeft, Info, Pencil } from "lucide-react";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
import { clearDraft, readDraft, type NoteDraft } from "../services/draftJournal";
import { NoteContextSheet } from "../components/NoteContextSheet";
import { VersionsSheet } from "../components/VersionsSheet";
import { EditorHost } from "../EditorHost";

/** Note view (extracted from App.tsx in R2): read-first with the pen toggle. */
export function NoteScreen({
  vault,
  path,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  const [doc, setDoc] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [info, setInfo] = useState(false);
  const [versions, setVersions] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // C4: live preview <-> raw markdown source (session mode, per note session).
  const [source, setSource] = useState(false);
  // Read-first (M4/E5): notes open rendered and read-only; the pen flips
  // into editing (and back), which also shows the keyboard toolbar.
  const [editing, setEditing] = useState(getMobileSettings().defaultView === "edit");
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  useEffect(() => {
    let stale = false;
    void vaultOps.read(vault, path).then(async (text) => {
      if (stale) return;
      setDoc(text);
      // Draft recovery (package G): offer an unsaved draft that is newer
      // than the file on disk and differs from it.
      const d = await readDraft(vault, path);
      if (stale || !d || d.text === text) return;
      const info = await vault.adapter.getFileInfo(path).catch(() => null);
      if (!stale && (!info || d.ts > info.mtime)) setDraft(d);
    });
    void vaultOps.getBookmarks(vault).then((marks) => {
      if (!stale) setMarked(marks.includes(path));
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  return (
    <div className="m-page m-page--note">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{title}</h1>
        <span className="m-headactions">
          <button
            aria-label={t("mobile.toggleBookmark")}
            aria-pressed={marked}
            className={`m-iconbtn${marked ? " is-active" : ""}`}
            onClick={() =>
              void vaultOps.toggleBookmark(vault, path).then((next) => setMarked(next))
            }
          >
            <Bookmark fill={marked ? "currentColor" : "none"} size={20} />
          </button>
          <button aria-label={t("mobile.noteInfo")} className="m-iconbtn" onClick={() => setInfo(true)}>
            <Info size={20} />
          </button>
          <button
            aria-label={editing ? t("mobile.doneEditing") : t("mobile.editNote")}
            aria-pressed={editing}
            className={`m-iconbtn${editing ? " is-active" : ""}`}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? <Check size={20} /> : <Pencil size={20} />}
          </button>
        </span>
      </header>
      {draft && (
        <div className="m-draftbanner">
          <span>
            {t("editor.draftBanner", {
              time: new Date(draft.ts).toLocaleTimeString(),
            })}
          </span>
          <span className="m-config-actions">
            <button
              className="m-chip"
              onClick={() => {
                const d = draft;
                setDraft(null);
                setDoc(d.text);
                setReloadTick((n) => n + 1);
                noteSaver.schedule(vault, path, d.text);
              }}
            >
              {t("editor.draftRestore")}
            </button>
            <button
              className="m-chip"
              onClick={() => {
                clearDraft(vault, path);
                setDraft(null);
              }}
            >
              {t("editor.draftDiscard")}
            </button>
          </span>
        </div>
      )}
      {doc !== null && (
        <EditorHost
          editable={editing}
          initialDoc={doc}
          key={`${path}#${reloadTick}`}
          onOpenNote={onOpenNote}
          path={path}
          vault={vault}
        />
      )}

      {info && (
        <NoteContextSheet
          onClose={() => setInfo(false)}
          onFind={() => window.dispatchEvent(new CustomEvent("m-editor-find", { detail: { path } }))}
          onJumpToLine={(line) =>
            window.dispatchEvent(new CustomEvent("m-editor-goto-line", { detail: { path, line } }))
          }
          onOpenNote={onOpenNote}
          onToggleSource={() =>
            setSource((s) => {
              window.dispatchEvent(
                new CustomEvent("m-editor-set-mode", { detail: { path, mode: s ? "live" : "source" } }),
              );
              return !s;
            })
          }
          onVersions={() => {
            setInfo(false);
            setVersions(true);
          }}
          path={path}
          sourceMode={source}
          vault={vault}
        />
      )}

      {versions && (
        <VersionsSheet
          onClose={() => setVersions(false)}
          onRestored={() => {
            void vaultOps.read(vault, path).then((text) => {
              setDoc(text);
              setReloadTick((n) => n + 1);
            });
          }}
          path={path}
          vault={vault}
        />
      )}
    </div>
  );
}
