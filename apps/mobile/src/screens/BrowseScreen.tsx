import { useEffect, useState, useRef } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bookmark,
  MoreVertical,
  Check,
  ChevronRight,
  CopyPlus,
  Database,
  FileText,
  Folder,
  FolderInput,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button, collapseContext, conflictOriginalPath, DocIcon, EmptyState, GroupCard, ICON, IconButton, isConflictCopyPath, isLargeDeletion, lineDiff, Row, RowList, SectionLabel } from "@plainva/ui";
import { countFolderFiles, countVaultFiles } from "../lib/folderDeletion";
import { mConfirm, mPrompt } from "../services/mobileDialogs";
import { noteSaver, vaultOps, type FolderListing, type MobileVault } from "../services/vaultService";
import { useLongPress } from "../lib/useLongPress";
import { SwipeRow } from "../components/SwipeRow";
import { SwipeHint } from "../components/SwipeHint";
import { confirmDeleteFile } from "../lib/deleteFile";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { relTimeAt } from "../lib/relTime";
import { AppBar } from "../components/AppBar";

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
  onCreateNote,
  onOpenBase,
  onOpenAttachment,
  pane = false,
}: {
  vault: MobileVault;
  folder: string;
  bump: number;
  onBack?: () => void;
  onOpenFolder: (path: string) => void;
  onOpenNote: (path: string) => void;
  /** Creates a note here — the empty folder's one action (S12). */
  onCreateNote?: () => void;
  onOpenBase: (path: string) => void;
  /** Rendered as a pane INSIDE the navigator: no page wrapper, no own pull. */
  pane?: boolean;
  /** Opens an attachment: an image in the viewer, anything else via the OS. */
  onOpenAttachment: (path: string, isImage: boolean) => void;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<
    Omit<FolderListing, "notes"> & { notes: Array<{ path: string; title: string; rel?: string }> }
  >({ folders: [], notes: [], bases: [], attachments: [] });
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const [sheet, setSheet] = useState<{ path: string; title: string; isFolder?: boolean; isBase?: boolean } | null>(
    null,
  );
  const [movePick, setMovePick] = useState<{ path: string; title: string } | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [conflictSheet, setConflictSheet] = useState<{ path: string; original: string } | null>(
    null,
  );
  // Multi-select light (package I): toggled from the long-press sheet; rows
  // then toggle membership and the action bar bulk-deletes with the shared
  // large-deletion double-check (>10 items OR >20% of the listing).
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Holding a note starts multi-select — one gesture, one meaning (S12). The
  // row's own menu is not lost: with exactly one row selected, the action bar
  // carries it, and the two frequent actions sit under the swipe.
  const press = useLongPress<{ path: string; title: string }>((x) => {
    setSelected((prev) => (prev ? prev : new Set([x.path])));
  });
  const folderPress = useLongPress<{ path: string; title: string }>((x) =>
    setSheet({ ...x, isFolder: true }),
  );
  const basePress = useLongPress<{ path: string; title: string }>((x) =>
    setSheet({ ...x, isBase: true }),
  );
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);
  useEffect(() => {
    let stale = false;
    // Custom note icons (desktop tree parity): one indexed map per load.
    void vault.queryService
      ?.getDocumentIcons()
      .then((m) => {
        if (!stale) setDocIcons(m);
      })
      .catch(() => {});
    void vaultOps.listFolder(vault, folder).then((l) => {
      if (stale) return;
      // Note rows carry a relative-time meta line (mockup .lrow); computed
      // here — render stays pure for the React compiler.
      const now = Date.now();
      setListing({
        ...l,
        notes: l.notes.map((n) => ({ path: n.path, title: n.title, rel: relTimeAt(now, n.mtime) ?? undefined })),
      });
    });
    // React reuses the instance when the navigator pushes a folder — the
    // root-only banner must clear or it sticks on pushed screens.
    if (folder) setConflicts([]);
    else if (vault.queryService) {
      // Conflict badge (P5): vault-wide scan for .CONFLICT copies.
      void vault.queryService.listNotes().then((rows) => {
        if (!stale) setConflicts(rows.map((r) => r.path).filter(isConflictCopyPath));
      });
    }
    return () => {
      stale = true;
    };
  }, [vault, folder, bump]);

  const noteRow = (n: { path: string; title: string; rel?: string }) => {
    const conflict = isConflictCopyPath(n.path);
    const row = (
      <Row
        key={n.path}
        onClick={() => {
          if (!press.clicked()) return;
          if (selected) {
            toggleSelected(n.path);
            return;
          }
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
        end={selected ? <span className={`m-slotmark${selected.has(n.path) ? " is-on" : ""}`} /> : undefined}
        icon={conflict
          ? <AlertTriangle className="m-warn" size={ICON.ui} />
          : docIcons.get(n.path)
            ? <DocIcon color={docIcons.get(n.path)!.color} icon={docIcons.get(n.path)!.icon} size={ICON.ui} />
            : <FileText size={ICON.ui} />}
        subtitle={n.rel}
        title={n.title}
      />
    );
    // While selecting, the row belongs to the selection — a swipe there would
    // act on one row inside a set the user is still building.
    if (selected) return <div key={n.path}>{row}</div>;
    return (
      <SwipeRow
        actions={[
          {
            icon: <Bookmark size={ICON.head} />,
            label: t("mobile.toggleBookmark"),
            onClick: () => bookmarkNote(n),
          },
          {
            icon: <Trash2 size={ICON.head} />,
            label: t("common.delete"),
            danger: true,
            onClick: () => deleteNote({ path: n.path, title: n.title }),
          },
        ]}
        key={n.path}
      >
        {row}
      </SwipeRow>
    );
  };

  const toggleSelected = (path: string) =>
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const bulkDelete = () => {
    if (!selected || selected.size === 0) return;
    void (async () => {
      const count = selected.size;
      // S4: the vault's file count, not the current folder's. Measuring the
      // share against one folder made the second prompt fire for three notes
      // out of ten while the vault held five hundred.
      const total = await countVaultFiles(vault.queryService);
      const ok = await mConfirm({
        title: t("common.delete"),
        message: t("dialogs.deleteManyConfirmMsg", { count }),
        danger: true,
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      // The shared E2 threshold — this used to be a hand-written copy that had
      // lost the "a single file never asks twice" clause.
      if (isLargeDeletion(count, total)) {
        const sure = await mConfirm({
          title: t("dialogs.deleteLargeTitle"),
          message: t("dialogs.deleteLargeMsg", { count, total }),
          danger: true,
          confirmLabel: t("dialogs.deleteLargeConfirm"),
        });
        if (!sure) return;
      }
      for (const p of selected) {
        try {
          await vaultOps.remove(vault, p);
        } catch {
          /* keep going; the sync chain surfaces persistent failures */
        }
      }
      setSelected(null);
    })();
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
        // S2: the original may be open with unsaved keystrokes — exactly the
        // situation that produced the conflict. Land them first, otherwise the
        // queued save settles after the promotion and puts the losing version
        // straight back.
        await noteSaver.flush(target.original);
        const text = await vaultOps.read(vault, target.path);
        await vaultOps.save(vault, target.original, text);
      }
      await vaultOps.remove(vault, target.path);
      setConflicts((c) => c.filter((p) => p !== target.path));
    })();
  };

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
      const parent = target.path.split("/").slice(0, -1).join("/");
      await vaultOps.renameFolder(vault, target.path, parent ? `${parent}/${trimmed}` : trimmed);
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
      await vaultOps.removeFolder(vault, target.path);
    })();
  };

  // Browsable move target (2026-07-17): the FolderPickerSheet walks the live
  // file system, so freshly created EMPTY folders are valid destinations — the
  // old index-backed getAllFolders() list could never offer them.
  const startMove = (target: { path: string; title: string }) => {
    setSheet(null);
    setMovePick(target);
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
      const { value, cancelled } = await mPrompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        initial: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      await vaultOps.rename(vault, target.path, trimmed);
    })();
  };

  const deleteNote = (target: { path: string; title: string }) => {
    setSheet(null);
    // Cascade-aware shared delete flow (plan Kaskadenloeschung): relation
    // targets get the cascade sheet, plain notes keep the slim confirm.
    void confirmDeleteFile(vault, target.path, target.title, t);
  };

  // What this folder holds, in the header line — the mockup's picture, and the
  // data is already on screen. Databases only appear when there are any: a
  // "0 databases" is noise in the one line a header can spare.
  const folderSummary = [
    t("mobile.folderCount", { count: listing.notes.length }),
    ...(listing.bases.length > 0 ? [t("mobile.baseCount", { count: listing.bases.length })] : []),
  ].join(" · ");

  const body = (
    <>
      {onBack && (
        <AppBar onBack={onBack} subtitle={folderSummary} title={folder.split("/").pop()} />
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
          <AlertTriangle size={ICON.ui} />
          <span>{t("mobile.conflictsBanner", { n: conflicts.length })}</span>
        </button>
      )}
      {/* Said once per vault, above the first list that HAS swipeable rows —
          notes, folders and databases all live below this line (R1.1). */}
      {(listing.folders.length > 0 || listing.bases.length > 0 || listing.notes.length > 0) && <SwipeHint />}
      {listing.folders.length > 0 && <SectionLabel>{t("mobile.folders")}</SectionLabel>}
      <GroupCard>
      <RowList>
      {listing.folders.map(({ name, count }) => {
        const full = folder ? `${folder}/${name}` : name;
        const target = { path: full, title: name };
        return (
          /* The same two actions its sheet offers, in the same order — one
             definition, two ways to reach it (round 3, E3). */
          <SwipeRow
            key={name}
            actions={[
              { icon: <Pencil size={ICON.head} />, label: t("mobile.vaultRename"), onClick: () => renameFolder(target) },
              { icon: <Trash2 size={ICON.head} />, label: t("mobile.deleteFolder"), danger: true, onClick: () => deleteFolder(target) },
            ]}
          >
            <Row
              onClick={() => {
                if (folderPress.clicked()) onOpenFolder(full);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSheet({ path: full, title: name, isFolder: true });
              }}
              onPointerCancel={folderPress.clear}
              onPointerDown={() => folderPress.start(target)}
              onPointerLeave={folderPress.clear}
              onPointerUp={folderPress.clear}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              icon={<Folder className="m-accent" size={ICON.ui} />}
              subtitle={t("mobile.folderCount", { count })}
              title={name}
            />
          </SwipeRow>
        );
      })}
      {listing.bases.map((b) => {
        const row = (
          <Row
            onClick={() => {
              if (!basePress.clicked()) return;
              if (selected) toggleSelected(b.path);
              else onOpenBase(b.path);
            }}
            onContextMenu={(e) => { e.preventDefault(); setSheet({ path: b.path, title: b.title, isBase: true }); }}
            onPointerCancel={basePress.clear}
            onPointerDown={() => basePress.start({ path: b.path, title: b.title })}
            onPointerLeave={basePress.clear}
            onPointerUp={basePress.clear}
            end={selected
              ? <span className={`m-slotmark${selected.has(b.path) ? " is-on" : ""}`} />
              : <ChevronRight className="m-chevron" size={ICON.ui} />}
            icon={<Database className="m-accent" size={ICON.ui} />}
            title={b.title}
          />
        );
        // While selecting, the row belongs to the selection — same rule the
        // note rows follow: a swipe would act on one row inside a set the user
        // is still building.
        if (selected) return <div key={b.path}>{row}</div>;
        return (
          <SwipeRow
            key={b.path}
            actions={[
              {
                icon: <Trash2 size={ICON.head} />,
                label: t("common.delete"),
                danger: true,
                onClick: () => void confirmDeleteFile(vault, b.path, b.title, t),
              },
            ]}
          >
            {row}
          </SwipeRow>
        );
      })}
      {listing.notes.map(noteRow)}

      {/* Attachments (S42). They were in the vault, synced and backed up, and
          no screen admitted they existed — a photo inserted into a note simply
          vanished from view. An image opens in the viewer; everything else is
          handed to the system, which knows what a PDF is and Plainva does not. */}
      {listing.attachments.map((a) => (
        <Row
          icon={a.isImage
            ? <ImageIcon className="m-accent" size={ICON.ui} />
            : <Paperclip className="m-accent" size={ICON.ui} />}
          key={a.path}
          onClick={() => onOpenAttachment(a.path, a.isImage)}
          title={a.name}
        />
      ))}
      </RowList>
      </GroupCard>
      {/* Rule 6: every empty state explains itself and offers exactly one
          action. An empty folder used to be a blank screen with a plus button
          somewhere else — nothing said what belonged here. */}
      {onCreateNote &&
        listing.folders.length === 0 &&
        listing.bases.length === 0 &&
        listing.attachments.length === 0 &&
        listing.notes.length === 0 && (
        <EmptyState
          title={t("mobile.emptyFolderTitle")}
          action={
            <Button onClick={onCreateNote} variant="primary">
              {t("mobile.newNote")}
            </Button>
          }
          icon={<FileText size={ICON.empty} />}
        >
          {t("mobile.emptyFolderBody")}
        </EmptyState>
      )}

      {selected && (
        <div className="m-selectbar">
          <span>{t("mobile.selectedCount", { n: selected.size })}</span>
          <span className="m-headactions">
            {selected.size === 1 && (
              <IconButton
                label={t("common.moreActions")}
                onClick={() => {
                  const path = [...selected][0];
                  const n = listing.notes.find((x) => x.path === path);
                  setSelected(null);
                  setSheet({ path, title: n?.title ?? path });
                }}
              >
                <MoreVertical size={ICON.head} />
              </IconButton>
            )}
            <IconButton label={t("common.delete")} disabled={selected.size === 0} onClick={bulkDelete}>
              <Trash2 size={ICON.head} />
            </IconButton>
            <IconButton label={t("common.cancel")} onClick={() => setSelected(null)}>
              <X size={ICON.head} />
            </IconButton>
          </span>
        </div>
      )}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setSheet(null)} />
            <p className="m-sheet-title">{sheet.title}</p>
            <button
              className="m-row"
              onClick={() => {
                const s = sheet;
                setSheet(null);
                if (s.isBase) onOpenBase(s.path);
                else if (s.isFolder) onOpenFolder(s.path);
                else onOpenNote(s.path);
              }}
            >
              {sheet.isBase ? <Database size={ICON.head} /> : sheet.isFolder ? <Folder size={ICON.head} /> : <FileText size={ICON.head} />}
              <span>{t("mobile.sheetOpen")}</span>
            </button>
            {!sheet.isFolder && !sheet.isBase && (
              <>
                <button className="m-row" onClick={() => startMove(sheet)}>
                  <FolderInput size={ICON.head} />
                  <span>{t("mobile.moveNote")}</span>
                </button>
                <button className="m-row" onClick={() => duplicateNote(sheet)}>
                  <CopyPlus size={ICON.head} />
                  <span>{t("mobile.duplicateNote")}</span>
                </button>
                <button className="m-row" onClick={() => bookmarkNote(sheet)}>
                  <Bookmark size={ICON.head} />
                  <span>{t("mobile.toggleBookmark")}</span>
                </button>
              </>
            )}
            {!sheet.isBase && (
              <button
                className="m-row"
                onClick={() => (sheet.isFolder ? renameFolder(sheet) : renameNote(sheet))}
              >
                <Pencil size={ICON.head} />
                <span>{t("mobile.vaultRename")}</span>
              </button>
            )}
            <button
              className="m-row m-danger"
              onClick={() => {
                if (sheet.isBase) {
                  const s = sheet;
                  setSheet(null);
                  void confirmDeleteFile(vault, s.path, s.title, t);
                } else if (sheet.isFolder) {
                  deleteFolder(sheet);
                } else {
                  deleteNote(sheet);
                }
              }}
            >
              <Trash2 size={ICON.head} />
              <span>{sheet.isFolder ? t("mobile.deleteFolder") : sheet.isBase ? t("common.delete") : t("mobile.deleteNote")}</span>
            </button>
          </div>
        </div>
      )}

      {conflictSheet && (
        <div className="m-sheet-backdrop" onClick={() => setConflictSheet(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setConflictSheet(null)} />
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
              <FileText size={ICON.head} />
              <span>{t("mobile.conflictOpenCopy")}</span>
            </button>
            <button className="m-row" onClick={() => resolveConflict(true)}>
              <Check size={ICON.head} />
              <span>{t("mobile.conflictKeepCopy")}</span>
            </button>
            <button className="m-row" onClick={() => resolveConflict(false)}>
              <Trash2 size={ICON.head} />
              <span>{t("mobile.conflictKeepOriginal")}</span>
            </button>
            <ConflictDiff conflictPath={conflictSheet.path} originalPath={conflictSheet.original} vault={vault} />
          </div>
        </div>
      )}

      {movePick && (
        <FolderPickerSheet
          vault={vault}
          title={t("mobile.moveNoteTo", { name: movePick.title })}
          onPick={(dest) => {
            const target = movePick;
            setMovePick(null);
            void vaultOps.moveNote(vault, target.path, dest);
          }}
          onClose={() => setMovePick(null)}
        />
      )}
    </>
  );

  if (pane) return body;
  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {body}
    </div>
  );
}

/** The root-level create-folder action, reused by the shell's top bar. */
export function createFolderPrompt(vault: MobileVault, folder: string, t: (k: string) => string) {
  void (async () => {
    const { value, cancelled } = await mPrompt({
      title: t("mobile.newFolder"),
      message: t("mobile.newFolderPrompt"),
    });
    const trimmed = value?.trim();
    if (cancelled || !trimmed) return;
    await vaultOps.createFolder(vault, folder ? `${folder}/${trimmed}` : trimmed);
  })();
}

/** Read-only line diff between the conflict copy and the current note (G3). */
function ConflictDiff({
  vault,
  conflictPath,
  originalPath,
}: {
  vault: MobileVault;
  conflictPath: string;
  originalPath: string;
}) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<ReturnType<typeof collapseContext> | null>(null);
  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        const [copy, original] = await Promise.all([
          vaultOps.read(vault, conflictPath),
          vaultOps.read(vault, originalPath),
        ]);
        const d = lineDiff(original, copy);
        if (!stale && d) setDiff(collapseContext(d, 2));
      } catch {
        /* one side unreadable: the sheet still offers the actions */
      }
    })();
    return () => {
      stale = true;
    };
  }, [vault, conflictPath, originalPath]);
  if (!diff) return null;
  return (
    <>
      <p className="m-sectionlabel m-sectionlabel--inset">
        {t("conflict.leftLabel")} / {t("conflict.rightLabel")}
      </p>
      <div className="m-diff">
        {diff.map((l, idx) =>
          l.type === "skip" ? (
            <div className="m-diff-skip" key={idx}>
              ... {l.count} ...
            </div>
          ) : (
            <div className={`m-diff-line is-${l.type}`} key={idx}>
              {l.text || " "}
            </div>
          ),
        )}
      </div>
    </>
  );
}
