import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Database,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { isConflictCopyPath, conflictOriginalPath } from "@plainva/ui";
import { Dialog } from "@capacitor/dialog";
import { vaultOps, type FolderListing, type MobileVault } from "../services/vaultService";
import { useLongPress } from "../lib/useLongPress";

/**
 * Folder browser (extracted from App.tsx in R2). As a tab root (no onBack)
 * the app shell renders the top bar; pushed folders carry their own header.
 */
export function BrowseScreen({
  vault,
  folder,
  bump,
  onBack,
  onOpenFolder,
  onOpenNote,
  onOpenBase,
}: {
  vault: MobileVault;
  folder: string;
  bump: number;
  onBack?: () => void;
  onOpenFolder: (path: string) => void;
  onOpenNote: (path: string) => void;
  onOpenBase: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<FolderListing>({ folders: [], notes: [], bases: [] });
  const [recent, setRecent] = useState<Array<{ path: string; title: string }>>([]);
  const [sheet, setSheet] = useState<{ path: string; title: string; isFolder?: boolean } | null>(
    null,
  );
  const [movePick, setMovePick] = useState<{ path: string; title: string } | null>(null);
  const [moveFolders, setMoveFolders] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [conflictSheet, setConflictSheet] = useState<{ path: string; original: string } | null>(
    null,
  );
  const press = useLongPress<{ path: string; title: string }>((x) => setSheet(x));
  const folderPress = useLongPress<{ path: string; title: string }>((x) =>
    setSheet({ ...x, isFolder: true }),
  );
  useEffect(() => {
    let stale = false;
    void vaultOps.listFolder(vault, folder).then((l) => {
      if (!stale) setListing(l);
    });
    if (!folder) {
      void vaultOps.recent(vault, 2).then((r) => {
        if (!stale) setRecent(r);
      });
      // Conflict badge (P5): vault-wide scan for .CONFLICT copies.
      if (vault.queryService) {
        void vault.queryService.listNotes().then((rows) => {
          if (!stale) setConflicts(rows.map((r) => r.path).filter(isConflictCopyPath));
        });
      }
    }
    return () => {
      stale = true;
    };
  }, [vault, folder, bump]);

  const noteRow = (n: { path: string; title: string }) => {
    const conflict = isConflictCopyPath(n.path);
    return (
      <button
        className="m-row"
        key={n.path}
        onClick={() => {
          if (!press.clicked()) return;
          if (conflict) {
            setConflictSheet({ path: n.path, original: conflictOriginalPath(n.path) ?? n.path });
          } else {
            onOpenNote(n.path);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setSheet({ path: n.path, title: n.title });
        }}
        onPointerCancel={press.clear}
        onPointerDown={() => press.start({ path: n.path, title: n.title })}
        onPointerLeave={press.clear}
        onPointerUp={press.clear}
      >
        {conflict ? <AlertTriangle className="m-warn" size={18} /> : <FileText size={18} />}
        <span>{n.title}</span>
      </button>
    );
  };

  // Conflict resolution (P5): both branches drop exactly one version, but
  // every write/delete goes through the backup adapter, so nothing is lost
  // for good. "Keep this copy" promotes the conflict text into the note.
  const resolveConflict = (keepCopy: boolean) => {
    const target = conflictSheet;
    if (!target) return;
    setConflictSheet(null);
    void (async () => {
      if (keepCopy) {
        const text = await vaultOps.read(vault, target.path);
        await vaultOps.save(vault, target.original, text);
      }
      await vaultOps.remove(vault, target.path);
      setConflicts((c) => c.filter((p) => p !== target.path));
    })();
  };

  const createFolder = () => {
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.newFolder"),
        message: t("mobile.newFolderPrompt"),
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed) return;
      await vaultOps.createFolder(vault, folder ? `${folder}/${trimmed}` : trimmed);
    })();
  };

  const renameFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        inputText: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      const parent = target.path.split("/").slice(0, -1).join("/");
      await vaultOps.renameFolder(vault, target.path, parent ? `${parent}/${trimmed}` : trimmed);
    })();
  };

  const deleteFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value } = await Dialog.confirm({
        title: t("mobile.deleteFolder"),
        message: t("mobile.deleteFolderConfirm", { name: target.title }),
      });
      if (!value) return;
      await vaultOps.removeFolder(vault, target.path);
    })();
  };

  const startMove = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const folders = vault.queryService ? await vault.queryService.getAllFolders() : [];
      setMoveFolders(folders);
      setMovePick(target);
    })();
  };

  const duplicateNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void vaultOps.duplicateNote(vault, target.path).then((copy) => onOpenNote(copy));
  };

  const bookmarkNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void vaultOps.toggleBookmark(vault, target.path);
  };

  const renameNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        inputText: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      await vaultOps.rename(vault, target.path, trimmed);
    })();
  };

  const deleteNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value } = await Dialog.confirm({
        title: t("mobile.deleteNote"),
        message: t("mobile.deleteNoteConfirm", { name: target.title }),
      });
      if (!value) return;
      await vaultOps.remove(vault, target.path);
    })();
  };

  return (
    <div className="m-page">
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{folder.split("/").pop()}</h1>
          <span className="m-headactions">
            <button aria-label={t("mobile.newFolder")} className="m-iconbtn" onClick={createFolder}>
              <FolderPlus size={22} />
            </button>
          </span>
        </header>
      )}
      {!folder && conflicts.length > 0 && (
        <button
          className="m-conflictbanner"
          onClick={() =>
            setConflictSheet({
              path: conflicts[0],
              original: conflictOriginalPath(conflicts[0]) ?? conflicts[0],
            })
          }
        >
          <AlertTriangle size={16} />
          <span>{t("mobile.conflictsBanner", { n: conflicts.length })}</span>
        </button>
      )}
      {recent.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.recent")}</p>
          {recent.map(noteRow)}
          <p className="m-sectionlabel">{t("mobile.folders")}</p>
        </>
      )}
      {listing.folders.map((name) => {
        const full = folder ? `${folder}/${name}` : name;
        return (
          <button
            className="m-row"
            key={name}
            onClick={() => {
              if (folderPress.clicked()) onOpenFolder(full);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSheet({ path: full, title: name, isFolder: true });
            }}
            onPointerCancel={folderPress.clear}
            onPointerDown={() => folderPress.start({ path: full, title: name })}
            onPointerLeave={folderPress.clear}
            onPointerUp={folderPress.clear}
          >
            <Folder className="m-accent" size={18} />
            <span>{name}</span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        );
      })}
      {listing.bases.map((b) => (
        <button className="m-row" key={b.path} onClick={() => onOpenBase(b.path)}>
          <Database className="m-accent" size={18} />
          <span>{b.title}</span>
          <ChevronRight className="m-chevron" size={18} />
        </button>
      ))}
      {listing.notes.map(noteRow)}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{sheet.title}</p>
            <button
              className="m-row"
              onClick={() => {
                setSheet(null);
                if (sheet.isFolder) onOpenFolder(sheet.path);
                else onOpenNote(sheet.path);
              }}
            >
              {sheet.isFolder ? <Folder size={18} /> : <FileText size={18} />}
              <span>{t("mobile.sheetOpen")}</span>
            </button>
            {!sheet.isFolder && (
              <>
                <button className="m-row" onClick={() => startMove(sheet)}>
                  <FolderInput size={18} />
                  <span>{t("mobile.moveNote")}</span>
                </button>
                <button className="m-row" onClick={() => duplicateNote(sheet)}>
                  <CopyPlus size={18} />
                  <span>{t("mobile.duplicateNote")}</span>
                </button>
                <button className="m-row" onClick={() => bookmarkNote(sheet)}>
                  <Bookmark size={18} />
                  <span>{t("mobile.toggleBookmark")}</span>
                </button>
              </>
            )}
            <button
              className="m-row"
              onClick={() => (sheet.isFolder ? renameFolder(sheet) : renameNote(sheet))}
            >
              <Pencil size={18} />
              <span>{t("mobile.vaultRename")}</span>
            </button>
            <button
              className="m-row m-danger"
              onClick={() => (sheet.isFolder ? deleteFolder(sheet) : deleteNote(sheet))}
            >
              <Trash2 size={18} />
              <span>{sheet.isFolder ? t("mobile.deleteFolder") : t("mobile.deleteNote")}</span>
            </button>
          </div>
        </div>
      )}

      {conflictSheet && (
        <div className="m-sheet-backdrop" onClick={() => setConflictSheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{t("mobile.conflictResolve")}</p>
            <p className="m-hint m-hint--inset">{t("mobile.conflictHint")}</p>
            <button
              className="m-row"
              onClick={() => {
                const p = conflictSheet.path;
                setConflictSheet(null);
                onOpenNote(p);
              }}
            >
              <FileText size={18} />
              <span>{t("mobile.conflictOpenCopy")}</span>
            </button>
            <button className="m-row" onClick={() => resolveConflict(true)}>
              <Check size={18} />
              <span>{t("mobile.conflictKeepCopy")}</span>
            </button>
            <button className="m-row" onClick={() => resolveConflict(false)}>
              <Trash2 size={18} />
              <span>{t("mobile.conflictKeepOriginal")}</span>
            </button>
          </div>
        </div>
      )}

      {movePick && (
        <div className="m-sheet-backdrop" onClick={() => setMovePick(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{t("mobile.moveNoteTo", { name: movePick.title })}</p>
            {["", ...moveFolders].map((dest) => (
              <button
                className="m-row"
                key={dest || "/"}
                onClick={() => {
                  const target = movePick;
                  setMovePick(null);
                  void vaultOps.moveNote(vault, target.path, dest);
                }}
              >
                <Folder className="m-accent" size={18} />
                <span>{dest || t("mobile.vaultRoot")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The root-level create-folder action, reused by the shell's top bar. */
export function createFolderPrompt(vault: MobileVault, folder: string, t: (k: string) => string) {
  void (async () => {
    const { value, cancelled } = await Dialog.prompt({
      title: t("mobile.newFolder"),
      message: t("mobile.newFolderPrompt"),
    });
    const trimmed = value?.trim();
    if (cancelled || !trimmed) return;
    await vaultOps.createFolder(vault, folder ? `${folder}/${trimmed}` : trimmed);
  })();
}
