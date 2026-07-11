import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Check, ChevronLeft, FileText, Info, Pencil } from "lucide-react";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
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
  const [info, setInfo] = useState<{
    props: Array<[string, string]>;
    backlinks: Array<{ path: string; title: string }>;
  } | null>(null);
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

  const openInfo = () => {
    void (async () => {
      const q = vault.queryService;
      const props: Array<[string, string]> = [];
      const backlinks: Array<{ path: string; title: string }> = [];
      if (q) {
        const raw = await q.getFileProperties(path);
        for (const [k, v] of Object.entries(raw)) {
          props.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
        }
        const links = await q.getBacklinks(path);
        const seen = new Set<string>();
        for (const l of links) {
          if (seen.has(l.source_path)) continue;
          seen.add(l.source_path);
          backlinks.push({
            path: l.source_path,
            title: l.source_path.split("/").pop()!.replace(/\.md$/i, ""),
          });
        }
      }
      setInfo({ props, backlinks });
    })();
  };

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
          <button aria-label={t("mobile.noteInfo")} className="m-iconbtn" onClick={openInfo}>
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
        <div className="m-sheet-backdrop" onClick={() => setInfo(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{t("mobile.noteInfo")}</p>
            {info.props.length > 0 && (
              <>
                <p className="m-sectionlabel m-sectionlabel--inset">{t("mobile.properties")}</p>
                {info.props.map(([k, v]) => (
                  <div className="m-row m-row--static" key={k}>
                    <span className="m-prop-key">{k}</span>
                    <span className="m-prop-val">{v}</span>
                  </div>
                ))}
              </>
            )}
            <p className="m-sectionlabel m-sectionlabel--inset">{t("mobile.backlinks")}</p>
            {info.backlinks.length === 0 ? (
              <p className="m-hint m-hint--inset">{t("mobile.noBacklinks")}</p>
            ) : (
              info.backlinks.map((b) => (
                <button
                  className="m-row"
                  key={b.path}
                  onClick={() => {
                    setInfo(null);
                    onOpenNote(b.path);
                  }}
                >
                  <FileText size={18} />
                  <span>{b.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
