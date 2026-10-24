import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, Database, FileText, Folder } from "lucide-react";
import { bookmarkKey, fileRowActions, ICON, isLargeDeletion, pickRowActions, toast, type RowActionSpec } from "@plainva/ui";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import type { SwipeAction } from "../components/SwipeRow";
import { countFolderFiles, countVaultFiles } from "./folderDeletion";
import { confirmDeleteFile } from "./deleteFile";
import { useLongPress } from "./useLongPress";
import { mConfirm, mPrompt } from "../services/mobileDialogs";
import { generateOverviewForFolder, overviewState, type FolderIndexState } from "../services/indexOverviews";
import { reportMoveFailure, vaultOps, type MobileVault } from "../services/vaultService";

/**
 * What a file, folder or database row can do on the phone — ONE place for
 * every list that shows such rows (plan Rückmeldungen 2026-10-24, E8).
 *
 * This lived inside the folder browser, which was the only list of vault rows.
 * The home screen's "Recent" and "Bookmarks" now open full lists of the same
 * rows, and a row there must answer a tap, a hold and a swipe exactly as it
 * does in the file list — otherwise the same note would be a different thing
 * depending on which list it is read from. So the browser's row grammar moved
 * here unchanged: the sheet a hold opens, the swipe subset, and the handlers
 * behind both. The entries themselves still come from the one shared list
 * (`fileRowActions`, Design-Runde E2) that the desktop's context menu reads.
 */

/** What kind of row a vault path is. Anything that is neither a note nor a
 *  database (an attachment) gets the database's verbs: it can be deleted. */
export type FileRowKind = "note" | "folder" | "base";

export interface FileRowSheetTarget {
  path: string;
  title: string;
  isFolder?: boolean;
  isBase?: boolean;
}

export function fileRowKind(path: string, isFolder = false): FileRowKind {
  if (isFolder) return "folder";
  return /\.md$/i.test(path) ? "note" : "base";
}

export function useFileRowSheet({
  vault,
  bump,
  onOpenNote,
  onOpenFolder,
  onOpenBase,
  onSelectMany,
  onRemoveFromList,
}: {
  vault: MobileVault;
  bump: number;
  onOpenNote: (path: string) => void;
  onOpenFolder: (path: string) => void;
  /** Defaults to `onOpenNote`, whose router sends a database to its screen. */
  onOpenBase?: (path: string) => void;
  /** The sheet's first entry where the list can select several (S22). */
  onSelectMany?: (path: string) => void;
  /** "Remove from list" for a list that is not the vault itself (Recent). */
  onRemoveFromList?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const openBase = onOpenBase ?? onOpenNote;
  const [bookmarked, setBookmarked] = useState(new Set<string>());
  useEffect(() => {
    let alive = true;
    const read = () => void vaultOps.getBookmarks(vault).then((entries) => { if (alive) setBookmarked(new Set(entries.map(bookmarkKey))); }).catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    read(); window.addEventListener("m-bookmarks-changed", read);
    return () => { alive = false; window.removeEventListener("m-bookmarks-changed", read); };
  }, [vault, bump, t]);
  const [sheet, setSheet] = useState<FileRowSheetTarget | null>(null);
  /**
   * Which overview action the open folder sheet offers — read when it opens,
   * not held for the whole listing: the answer is a file read per folder, and
   * a sheet is one folder. `null` while unknown and for a folder whose
   * index.md is the user's own, where nothing is offered at all.
   */
  const [sheetIndex, setSheetIndex] = useState<FolderIndexState | null>(null);
  const [movePick, setMovePick] = useState<{ path: string; title: string; isFolder?: boolean } | null>(null);
  // S22: holding a row opens what that row can do — on EVERY kind of row.
  //
  // "One gesture, one meaning" was the stated rule, and in one and the same
  // list it was broken: holding a note began multi-select while holding a
  // folder or a database opened its sheet. Which of the two you got depended
  // on what you happened to be holding. Selecting several is now the sheet's
  // first entry, so it is named rather than guessed at, and the gesture means
  // the same thing everywhere.
  const press = useLongPress<{ path: string; title: string }>((x) => setSheet(x));
  const folderPress = useLongPress<{ path: string; title: string }>((x) =>
    setSheet({ ...x, isFolder: true }),
  );
  const basePress = useLongPress<{ path: string; title: string }>((x) =>
    setSheet({ ...x, isBase: true }),
  );
  useEffect(() => {
    if (!sheet?.isFolder) return void setSheetIndex(null);
    let stale = false;
    setSheetIndex(null);
    void overviewState(vault, sheet.path).then((state) => {
      if (!stale) setSheetIndex(state);
    });
    return () => {
      stale = true;
    };
  }, [sheet, vault]);

  const renameFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        initial: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      await vaultOps.renameFolder(vault, target.path, trimmed).catch(reportMoveFailure);
    })();
  };

  const deleteFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      // S4/E1: count first. A phone has no trash, so the number and the
      // sentence about what cannot be restored have to arrive BEFORE the tap —
      // afterwards there is nowhere to walk them back.
      const entries = await vault.files.listDir(target.path, true).catch(() => []);
      const count = countFolderFiles(entries);
      // An empty folder has nothing to lose, so it keeps the plain question —
      // a warning about unrecoverable files would be noise there.
      const ok = await mConfirm(
        count === 0
          ? {
              title: t("mobile.deleteFolder"),
              message: t("mobile.deleteFolderConfirm", { name: target.title }),
              danger: true,
              confirmLabel: t("common.delete"),
            }
          : {
              title: t("mobile.deleteFolderTitle", { name: target.title, count }),
              message: t("mobile.deleteFolderWarn"),
              danger: true,
              confirmLabel: t("mobile.deleteFilesAction", { count }),
            },
      );
      if (!ok) return;
      const total = await countVaultFiles(vault.queryService);
      if (isLargeDeletion(count, total)) {
        const sure = await mConfirm({
          title: t("dialogs.deleteLargeTitle"),
          message: t("dialogs.deleteLargeMsg", { count, total }),
          danger: true,
          confirmLabel: t("dialogs.deleteLargeConfirm"),
        });
        if (!sure) return;
      }
      await vaultOps.removeFolder(vault, target.path, { confirmed: true });
    })();
  };

  // Browsable move target (2026-07-17): the FolderPickerSheet walks the live
  // file system, so freshly created EMPTY folders are valid destinations — the
  // old index-backed getAllFolders() list could never offer them.
  const startMove = (target: { path: string; title: string; isFolder?: boolean }) => {
    setSheet(null);
    setMovePick(target);
  };

  const duplicateNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void vaultOps.duplicateNote(vault, target.path).then((copy) => onOpenNote(copy));
  };

  const bookmarkNote = (target: { path: string; title: string }, type: "file" | "folder" = "file") => {
    setSheet(null);
    void vaultOps.toggleBookmark(vault, target.path, type).catch(() => toast.error(t("sidebar.bookmarkSaveFailed")));
  };

  const renameNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        initial: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      await vaultOps.rename(vault, target.path, trimmed).catch(reportMoveFailure);
    })();
  };

  const deleteNote = (target: { path: string; title: string }) => {
    setSheet(null);
    // Cascade-aware shared delete flow (plan Kaskadenloeschung): relation
    // targets get the cascade sheet, plain notes keep the slim confirm.
    void confirmDeleteFile(vault, target.path, target.title, t);
  };

  const removeFromList = onRemoveFromList
    ? (target: { path: string }) => {
        setSheet(null);
        onRemoveFromList(target.path);
      }
    : undefined;

  /**
   * What a row can do — the one list both shells read (Design-Runde E2). The
   * sheet shows all of it, the swipe its `swipe` subset, the desktop's context
   * menu the same entries in the same order. A base is a file with fewer
   * verbs; folders also keep their overview action.
   */
  const rowActionsFor = (target: { path: string; title: string }, kind: FileRowKind, index: FolderIndexState | null = null): RowActionSpec[] => {
    const closeThen = (fn: () => void) => () => {
      setSheet(null);
      fn();
    };
    if (kind === "folder") {
      // `index` is the sheet's own reading of the overview state (loaded when
      // it opens); the swipe passes none and offers no overview.
      return fileRowActions(t, {
        isFolder: true,
        bookmarked: bookmarked.has(bookmarkKey({ type: "folder", path: target.path })),
        bookmark: () => bookmarkNote(target, "folder"),
        rename: () => renameFolder(target),
        move: () => startMove({ ...target, isFolder: true }),
        overview: index !== null && index !== "manual" ? closeThen(() => void generateOverviewForFolder(vault, target.path)) : undefined,
        overviewExists: index === "managed",
        delete: () => deleteFolder(target),
      });
    }
    if (kind === "base") {
      return fileRowActions(t, {
        removeFromList: removeFromList && (() => removeFromList(target)),
        delete: closeThen(() => void confirmDeleteFile(vault, target.path, target.title, t)),
      });
    }
    return fileRowActions(t, {
      rename: () => renameNote(target),
      duplicate: () => duplicateNote(target),
      move: () => startMove(target),
      bookmarked: bookmarked.has(bookmarkKey({ type: "file", path: target.path })),
      bookmark: () => bookmarkNote(target),
      removeFromList: removeFromList && (() => removeFromList(target)),
      delete: () => deleteNote(target),
    });
  };
  /** The swipe primitive wants elements, the list carries icon components. */
  const asSheet = (list: RowActionSpec[]): SwipeAction[] =>
    list.map((a) => ({ icon: <a.icon size={ICON.head} />, label: a.label, danger: a.danger, onClick: a.run }));
  /**
   * What a swipe on the row offers: a note and a database their `swipe`
   * subset, a folder the same two its sheet ends with (round 3, E3) — one
   * definition, two ways to reach it.
   */
  const swipeFor = (target: { path: string; title: string }, kind: FileRowKind): SwipeAction[] =>
    asSheet(
      kind === "folder"
        ? pickRowActions(rowActionsFor(target, "folder"), ["rename", "delete"])
        : rowActionsFor(target, kind).filter((a) => a.swipe),
    );

  const sheetLayer: ReactNode = (
    <>
      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setSheet(null)} />
            <p className="m-sheet-title">{sheet.title}</p>
            {/* First, because it is the one action that changes what the LIST
                does rather than what this row does — and because it used to be
                the gesture itself, with no name anywhere (S22). A list that
                cannot select several (Recent, Bookmarks) does not offer it. */}
            {onSelectMany && (
              <button
                className="m-row"
                data-testid="sheet-select-many"
                onClick={() => {
                  const s = sheet;
                  setSheet(null);
                  onSelectMany(s.path);
                }}
              >
                <CheckSquare size={ICON.head} />
                <span>{t("mobile.selectMany", { defaultValue: "Mehrere auswählen" })}</span>
              </button>
            )}
            <button
              className="m-row"
              onClick={() => {
                const s = sheet;
                setSheet(null);
                if (s.isBase) openBase(s.path);
                else if (s.isFolder) onOpenFolder(s.path);
                else onOpenNote(s.path);
              }}
            >
              {sheet.isBase ? <Database size={ICON.head} /> : sheet.isFolder ? <Folder size={ICON.head} /> : <FileText size={ICON.head} />}
              <span>{t("mobile.sheetOpen")}</span>
            </button>
            {/* The row's actions, from the ONE list both shells read (Design-
                Runde E2): the same entries, words and order as the desktop's
                context menu and the swipe on this row. The delete sits last,
                behind its hairline, because the list says so. */}
            {rowActionsFor(sheet, sheet.isFolder ? "folder" : sheet.isBase ? "base" : "note", sheetIndex).map((a, i, all) => (
              <button
                key={a.id}
                className={a.danger ? "m-row m-danger" : "m-row"}
                data-sheet-sep={a.danger && !all[i - 1]?.danger ? "" : undefined}
                data-testid={a.id === "overview" ? "sheet-overview" : `sheet-${a.id}`}
                onClick={a.run}
              >
                <a.icon size={ICON.head} />
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {movePick && (
        <FolderPickerSheet
          vault={vault}
          title={t("mobile.moveNoteTo", { name: movePick.title })}
          excludePrefix={movePick.isFolder ? movePick.path : undefined}
          onPick={(dest) => {
            const target = movePick;
            setMovePick(null);
            void (target.isFolder
              ? vaultOps.moveFolder(vault, target.path, dest ? `${dest}/${target.path.split("/").pop()}` : target.path.split("/").pop()!)
              : vaultOps.moveNote(vault, target.path, dest)).catch(reportMoveFailure);
          }}
          onClose={() => setMovePick(null)}
        />
      )}
    </>
  );

  return { sheet, setSheet, press, folderPress, basePress, rowActionsFor, asSheet, swipeFor, sheetLayer };
}
