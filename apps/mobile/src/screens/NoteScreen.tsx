import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  Code,
  History,
  MoreVertical,
  Paintbrush,
  Pencil,
  Search,
  SlidersHorizontal,
  Smile,
  Star,
  Trash2,
} from "lucide-react";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
import { mPrompt } from "../services/mobileDialogs";
import { confirmDeleteFile } from "../lib/deleteFile";
import { clearDraft, readDraft, type NoteDraft } from "../services/draftJournal";
import { NoteContextSheet, type ContextTab } from "../components/NoteContextSheet";
import { RowActionSheet } from "../components/RowActionSheet";
import { EditorHost } from "../EditorHost";

/**
 * Note view (M3E mockup 2/3): read-first. Reading shows back · title · star ·
 * ⋮ plus a pencil FAB; editing collapses the bar to back · title · tonal
 * check. File actions (icon, stripe, source toggle, find, rename, delete)
 * live in the ⋮ sheet; properties render as a tappable chip row that opens
 * the context sheet.
 */
export function NoteScreen({
  vault,
  path,
  onBack,
  onOpenNote,
  onRenamed,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  /** Retargets the open nav entry after a rename (path changes). */
  onRenamed: (newPath: string) => void;
}) {
  const { t } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  const [doc, setDoc] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [info, setInfo] = useState<ContextTab | null>(null);
  const [menu, setMenu] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // C4: live preview <-> raw markdown source (session mode, per note session).
  const [source, setSource] = useState(false);
  // Read-first (M4/E5): notes open rendered and read-only; the pencil FAB
  // flips into editing (and back), which also shows the keyboard toolbar.
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

  const editorEvent = (name: string) => window.dispatchEvent(new CustomEvent(name, { detail: { path } }));

  const rename = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("common.rename"),
        message: t("mobile.renamePrompt"),
        initial: title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === title) return;
      const dir = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
      await vaultOps.rename(vault, path, trimmed);
      onRenamed(`${dir}${trimmed}.md`);
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
          {!editing && (
            <button
              aria-label={t("mobile.toggleBookmark")}
              aria-pressed={marked}
              className={`m-iconbtn${marked ? " is-active" : ""}`}
              onClick={() =>
                void vaultOps.toggleBookmark(vault, path).then((next) => setMarked(next))
              }
            >
              <Star fill={marked ? "currentColor" : "none"} size={20} />
            </button>
          )}
          {!editing && (
            <button aria-label={t("mobile.noteMenu")} className="m-iconbtn" onClick={() => setMenu(true)}>
              <MoreVertical size={20} />
            </button>
          )}
          {editing && (
            <button
              aria-label={t("mobile.doneEditing")}
              className="m-iconbtn is-tonal"
              onClick={() => setEditing(false)}
            >
              <Check size={20} />
            </button>
          )}
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
      {!editing && (
        <button aria-label={t("mobile.editNote")} className="m-fab-float" onClick={() => setEditing(true)}>
          <Pencil size={22} />
        </button>
      )}

      {menu && (
        <RowActionSheet
          title={title}
          onClose={() => setMenu(false)}
          actions={[
            {
              icon: <Smile size={18} />,
              label: t("docHeader.changeIcon"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-pick-icon");
              },
            },
            {
              icon: <Paintbrush size={18} />,
              label: t("docHeader.changeColor"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-pick-color");
              },
            },
            {
              icon: <SlidersHorizontal size={18} />,
              label: t("rightPanel.properties"),
              onClick: () => {
                setMenu(false);
                setInfo("props");
              },
            },
            {
              icon: <History size={18} />,
              label: t("versions.title"),
              onClick: () => {
                setMenu(false);
                setInfo("history");
              },
            },
            {
              icon: <Code size={18} />,
              label: source ? t("editor.livePreview") : t("editor.sourceMode"),
              onClick: () => {
                setMenu(false);
                setSource((s) => {
                  window.dispatchEvent(
                    new CustomEvent("m-editor-set-mode", { detail: { path, mode: s ? "live" : "source" } }),
                  );
                  return !s;
                });
              },
            },
            {
              icon: <Search size={18} />,
              label: t("search.find"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-find");
              },
            },
            {
              icon: <Pencil size={18} />,
              label: t("common.rename"),
              onClick: () => {
                setMenu(false);
                rename();
              },
            },
            {
              icon: <Trash2 size={18} />,
              label: t("common.delete"),
              danger: true,
              onClick: () => {
                setMenu(false);
                void confirmDeleteFile(vault, path, title, t).then((ok) => {
                  if (ok) onBack();
                });
              },
            },
          ]}
        />
      )}

      {info && (
        <NoteContextSheet
          initialTab={info}
          onClose={() => setInfo(null)}
          onMutated={() => {
            void vaultOps.read(vault, path).then((text) => {
              setDoc(text);
              setReloadTick((n) => n + 1);
            });
          }}
          onJumpToLine={(line) =>
            window.dispatchEvent(new CustomEvent("m-editor-goto-line", { detail: { path, line } }))
          }
          onOpenNote={onOpenNote}
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
