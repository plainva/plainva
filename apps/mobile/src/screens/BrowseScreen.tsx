import { useEffect, useState, useRef } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  MoreVertical,
  CheckSquare,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  X,
  ArrowUpDown,
  Check,
} from "lucide-react";
import { Button, conflictOriginalPath, DocIcon, EmptyState, fileRowActions, GroupCard, ICON, IconButton, isConflictCopyPath, isLargeDeletion, pickRowActions, Row, RowList, SearchField, SectionLabel, type RowActionSpec } from "@plainva/ui";
import { matchesFolderQuery, nextFolderSort, readStoredFolderSort, sortFolderEntries, timesAreUniform, writeStoredFolderSort, type FolderSort, type FolderSortKey } from "@plainva/ui";
import { countFolderFiles, countVaultFiles } from "../lib/folderDeletion";
import { mConfirm, mPrompt } from "../services/mobileDialogs";
import { vaultOps, type FolderListing, type MobileVault } from "../services/vaultService";
import { useLongPress } from "../lib/useLongPress";
import { SwipeRow } from "../components/SwipeRow";
import { SwipeHint } from "../components/SwipeHint";
import { confirmDeleteFile } from "../lib/deleteFile";
import { generateOverviewForFolder, overviewState, type FolderIndexState } from "../services/indexOverviews";
import { refreshVaultAction, usePullToRefresh } from "../lib/usePullToRefresh";
import { relTimeAt } from "../lib/relTime";
import { AppBar } from "../components/AppBar";
import { ConflictCompareSheet } from "../components/ConflictCompareSheet";

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
  /**
   * Which overview action the open folder sheet offers — read when it opens,
   * not held for the whole listing: the answer is a file read per folder, and
   * a sheet is one folder. `null` while unknown and for a folder whose
   * index.md is the user's own, where nothing is offered at all.
   */
  const [sheetIndex, setSheetIndex] = useState<FolderIndexState | null>(null);
  const [movePick, setMovePick] = useState<{ path: string; title: string } | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  // Sorting and searching in the folder (feedback round 2026-09-01, P11/T5):
  // a real vault put 640 notes in one folder, hard-sorted by title with no
  // search box. The sort is the desktop tree's and is remembered per device
  // under the same key; the query filters every kind of row by its name.
  const [sort, setSort] = useState<FolderSort>(() => readStoredFolderSort());
  const [query, setQuery] = useState("");
  const [sortSheet, setSortSheet] = useState(false);
  const chooseSort = (key: FolderSortKey) => {
    setSort((current) => {
      const next = nextFolderSort(current, key);
      writeStoredFolderSort(next);
      return next;
    });
  };
  const [conflictSheet, setConflictSheet] = useState<{ path: string; original: string } | null>(
    null,
  );
  // Multi-select light (package I): toggled from the long-press sheet; rows
  // then toggle membership and the action bar bulk-deletes with the shared
  // large-deletion double-check (>10 items OR >20% of the listing).
  const [selected, setSelected] = useState<Set<string> | null>(null);
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
  const ptrRef = useRef<HTMLDivElement>(null);
  // The pull reads THIS folder first and lets the sync run behind it
  // (feedback round 2026-09-01, M3). The default handler ran a full resync,
  // waited up to eight seconds for it and only then re-read the folder — the
  // one thing the gesture was for came last.
  const [refreshTick, setRefreshTick] = useState(0);
  const ptrIndicator = usePullToRefresh(ptrRef, async () => {
    setRefreshTick((n) => n + 1);
    void refreshVaultAction();
  });
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
  }, [vault, folder, bump, refreshTick]);

  // What the screen shows: the listing under the chosen sort, narrowed by the
  // query. Folders keep their name order in every mode (they have no times).
  const shown = {
    folders: listing.folders.filter((f) => matchesFolderQuery(f.name, query)),
    bases: sortFolderEntries(listing.bases.filter((b) => matchesFolderQuery(b.title, query)), { key: "title", dir: sort.key === "title" ? sort.dir : "asc" }),
    notes: sortFolderEntries(listing.notes.filter((n) => matchesFolderQuery(n.title, query)), sort),
    attachments: listing.attachments.filter((a) => matchesFolderQuery(a.name, query)),
  };
  // "218 days ago" under every row of a vault copied in one go says nothing
  // and costs half a row: when the times cannot tell the rows apart, the
  // subtitle goes (T5, second finding).
  const showRel = !timesAreUniform(listing.notes);
  const nothingMatches = query.trim() !== "" && shown.folders.length + shown.bases.length + shown.notes.length + shown.attachments.length === 0;
  const hasRows = listing.folders.length + listing.bases.length + listing.notes.length + listing.attachments.length > 0;

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
        subtitle={showRel ? n.rel : undefined}
        title={n.title}
      />
    );
    // While selecting, the row belongs to the selection — a swipe there would
    // act on one row inside a set the user is still building.
    if (selected) return <div key={n.path}>{row}</div>;
    return (
      <SwipeRow actions={asSheet(rowActionsFor(n, "note").filter((a) => a.swipe))} key={n.path}>
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

  /**
   * What a row can do — the one list both shells read (Design-Runde E2). The
   * sheet shows all of it, the swipe its `swipe` subset, the desktop's context
   * menu the same entries in the same order. A base is a file with fewer
   * verbs; a folder has its overview note instead of a bookmark.
   */
  const rowActionsFor = (target: { path: string; title: string }, kind: "note" | "folder" | "base", index: FolderIndexState | null = null): RowActionSpec[] => {
    const closeThen = (fn: () => void) => () => {
      setSheet(null);
      fn();
    };
    if (kind === "folder") {
      // `index` is the sheet's own reading of the overview state (loaded when
      // it opens); the swipe passes none and offers no overview.
      return fileRowActions(t, {
        isFolder: true,
        rename: () => renameFolder(target),
        overview: index !== null && index !== "manual" ? closeThen(() => void generateOverviewForFolder(vault, target.path)) : undefined,
        overviewExists: index === "managed",
        delete: () => deleteFolder(target),
      });
    }
    if (kind === "base") {
      return fileRowActions(t, { delete: closeThen(() => void confirmDeleteFile(vault, target.path, target.title, t)) });
    }
    return fileRowActions(t, {
      rename: () => renameNote(target),
      duplicate: () => duplicateNote(target),
      move: () => startMove(target),
      bookmark: () => bookmarkNote(target),
      delete: () => deleteNote(target),
    });
  };
  /** The swipe primitive wants elements, the list carries icon components. */
  const asSheet = (list: RowActionSpec[]) =>
    list.map((a) => ({ icon: <a.icon size={ICON.head} />, label: a.label, danger: a.danger, onClick: a.run }));

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
      {ptrIndicator}
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
      {hasRows && (
        <div className="m-browse-tools">
          <SearchField
            clearLabel={t("sidebar.clearSearch")}
            onValueChange={setQuery}
            placeholder={t("browse.filter")}
            value={query}
            data-testid="browse-filter"
          />
          <IconButton
            active={sort.key !== "title"}
            label={t("browse.sortBy")}
            onClick={() => setSortSheet(true)}
            data-testid="browse-sort"
          >
            <ArrowUpDown size={ICON.ui} />
          </IconButton>
        </div>
      )}
      {nothingMatches && <p className="m-hint">{t("browse.noMatches", { q: query.trim() })}</p>}
      {(shown.folders.length > 0 || shown.bases.length > 0 || shown.notes.length > 0) && <SwipeHint />}
      {shown.folders.length > 0 && <SectionLabel>{t("mobile.folders")}</SectionLabel>}
      <GroupCard>
      <RowList>
      {shown.folders.map(({ name, count }) => {
        const full = folder ? `${folder}/${name}` : name;
        const target = { path: full, title: name };
        return (
          /* The same two actions its sheet offers, in the same order — one
             definition, two ways to reach it (round 3, E3). */
          <SwipeRow key={name} actions={asSheet(pickRowActions(rowActionsFor(target, "folder"), ["rename", "delete"]))}>
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
      {shown.bases.map((b) => {
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
          <SwipeRow key={b.path} actions={asSheet(rowActionsFor(b, "base").filter((a) => a.swipe))}>
            {row}
          </SwipeRow>
        );
      })}
      {shown.notes.map(noteRow)}

      {/* Attachments (S42). They were in the vault, synced and backed up, and
          no screen admitted they existed — a photo inserted into a note simply
          vanished from view. An image opens in the viewer; everything else is
          handed to the system, which knows what a PDF is and Plainva does not. */}
      {shown.attachments.map((a) => (
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
            {/* First, because it is the one action that changes what the LIST
                does rather than what this row does — and because it used to be
                the gesture itself, with no name anywhere (S22). */}
            <button
              className="m-row"
              data-testid="sheet-select-many"
              onClick={() => {
                const s = sheet;
                setSheet(null);
                setSelected((prev) => (prev ? prev : new Set([s.path])));
              }}
            >
              <CheckSquare size={ICON.head} />
              <span>{t("mobile.selectMany", { defaultValue: "Mehrere auswählen" })}</span>
            </button>
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

      {sortSheet && (
        <div className="m-sheet-backdrop" onClick={() => setSortSheet(false)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="browse-sort-sheet">
            <SheetGrip onClose={() => setSortSheet(false)} />
            <p className="m-sheet-title">{t("browse.sortBy")}</p>
            {(["title", "modified", "created"] as const).map((key) => (
              <button
                key={key}
                className="m-row"
                onClick={() => chooseSort(key)}
                aria-pressed={sort.key === key}
              >
                {sort.key === key ? <Check size={ICON.head} /> : <span className="m-row-spacer" />}
                <span>{t(key === "title" ? "browse.sortTitle" : key === "modified" ? "browse.sortModified" : "browse.sortCreated")}</span>
                {sort.key === key && (
                  <span className="m-row-detail">{t(sort.dir === "asc" ? "browse.sortAsc" : "browse.sortDesc")}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {conflictSheet && (
        <ConflictCompareSheet
          vault={vault}
          conflictPath={conflictSheet.path}
          originalPath={conflictSheet.original}
          onClose={() => setConflictSheet(null)}
          onResolved={(touched) => {
            setConflictSheet(null);
            setConflicts((c) => c.filter((p) => !touched.includes(p)));
          }}
        />
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
