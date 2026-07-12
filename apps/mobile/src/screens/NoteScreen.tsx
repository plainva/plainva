import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Check, ChevronLeft, Info, Pencil } from "lucide-react";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
import { NoteContextSheet } from "../components/NoteContextSheet";
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
  // Read-first (M4/E5): notes open rendered and read-only; the pen flips
  // into editing (and back), which also shows the keyboard toolbar.
  const [editing, setEditing] = useState(getMobileSettings().defaultView === "edit");
  useEffect(() => {
    let stale = false;
    void vaultOps.read(vault, path).then((text) => {
      if (!stale) setDoc(text);
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
      {doc !== null && (
        <EditorHost
          editable={editing}
          initialDoc={doc}
          onOpenNote={onOpenNote}
          path={path}
          vault={vault}
        />
      )}

      {info && (
        <NoteContextSheet
          onClose={() => setInfo(false)}
          onJumpToLine={(line) =>
            window.dispatchEvent(new CustomEvent("m-editor-goto-line", { detail: { path, line } }))
          }
          onOpenNote={onOpenNote}
          path={path}
          vault={vault}
        />
      )}
    </div>
  );
}
