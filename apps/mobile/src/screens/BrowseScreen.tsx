import { useEffect, useState, useRef } from "react";
import { SortSheet } from "../components/SortSheet";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  MoreVertical,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  X,
  ArrowUpDown,
} from "lucide-react";
import { Button, conflictOriginalPath, DocIcon, EmptyState, errorText, GroupCard, ICON, IconButton, isConflictCopyPath, isLargeDeletion, Row, RowList, SearchField, SectionLabel } from "@plainva/ui";
import { matchesFolderQuery, nextFolderSort, readStoredFolderSort, resolveOpenAction, sortFolderEntries, timesAreUniform, writeStoredFolderSort, type FolderSort, type FolderSortKey } from "@plainva/ui";
import { countVaultFiles } from "../lib/folderDeletion";
import { mConfirm, mPrompt } from "../services/mobileDialogs";
import { rereadVault, vaultOps, type FolderListing, type MobileVault } from "../services/vaultService";
import { useFileRowSheet } from "../lib/useFileRowSheet";
import { SwipeRow } from "../components/SwipeRow";
import { SwipeHint } from "../components/SwipeHint";
import { refreshVaultAction, usePullToRefresh } from "../lib/usePullToRefresh";
import { relTimeAt } from "../lib/relTime";
import { AppBar } from "../components/AppBar";
import { ConflictCompareSheet } from "../components/ConflictCompareSheet";
import { ChoiceMark } from "../components/ChoiceMark";

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
  const [conflicts, setConflicts] = useState<string[]>([]);
  /** Why the folder could not be read; `null` while it can be, or is being, read. */
  const [failure, setFailure] = useState<string | null>(null);
  /** True until the first listing has arrived — "not read yet" is not "empty". */
  const [loading, setLoading] = useState(true);
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
  const { setSheet, press, folderPress, basePress, swipeFor, sheetLayer } = useFileRowSheet({
    vault,
    bump,
    onOpenNote,
    onOpenFolder,
    onOpenBase,
    // Selecting several is the sheet's first entry here (S22): the list owns
    // the selection, the shared row grammar only names it.
    onSelectMany: (path) => setSelected((prev) => (prev ? prev : new Set([path]))),
  });
  const ptrRef = useRef<HTMLDivElement>(null);
  // The pull reads THIS folder first and lets the sync run behind it
  // (feedback round 2026-09-01, M3). The default handler ran a full resync,
  // waited up to eight seconds for it and only then re-read the folder — the
  // one thing the gesture was for came last.
  const [refreshTick, setRefreshTick] = useState(0);
  const ptrIndicator = usePullToRefresh(ptrRef, async () => {
    // This folder is read into the index first — including what vanished from
    // it (issue 110, E8) — then the listing, then the sync behind it.
    await rereadVault(folder).catch(() => {});
    setRefreshTick((n) => n + 1);
    void refreshVaultAction({ rereadLocal: false });
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
    setFailure(null);
    setLoading(true);
    void vaultOps.listFolder(vault, folder).then((l) => {
      if (stale) return;
      setLoading(false);
      // Note rows carry a relative-time meta line (mockup .lrow); computed
      // here — render stays pure for the React compiler.
      const now = Date.now();
      setListing({
        ...l,
        notes: l.notes.map((n) => ({ path: n.path, title: n.title, rel: relTimeAt(now, n.mtime) ?? undefined })),
      });
    }).catch((error: unknown) => {
      // Reading a folder can fail — a permission, a provider that has not put
      // the files on the device yet, a path the platform will not open. It
      // used to fail silently and leave the INITIAL empty listing standing, so
      // the screen said "this folder is empty", which is the one thing it did
      // not know (issue 104).
      if (!stale) { setFailure(errorText(error)); setLoading(false); }
    });
    // React reuses the instance when the navigator pushes a folder — the
    // root-only banner must clear or it sticks on pushed screens.
    if (folder) setConflicts([]);
    else {
      // Conflict badge (P5): vault-wide scan for .CONFLICT copies.
      void Promise.all([vault.queryService?.listNotes() ?? vault.files.listDir("", true), vault.files.listConflictSessions?.() ?? Promise.resolve([])]).then(([rows, sessions]) => {
        if (!stale) setConflicts([...new Set([...sessions.map(s => s.workingCopyPath), ...rows.map((r) => r.path).filter(isConflictCopyPath)])]);
      }).catch(() => { /* Keep the last known count if the provider cannot be read. */ });
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
        end={selected ? <ChoiceMark multiple on={selected.has(n.path)} /> : undefined}
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
      <SwipeRow actions={swipeFor(n, "note")} key={n.path}>
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
          await vaultOps.remove(vault, p, { confirmed: true });
        } catch {
          /* keep going; the sync chain surfaces persistent failures */
        }
      }
      setSelected(null);
    })();
  };

  // What this folder holds, in the header line — the mockup's picture, and the
  // data is already on screen. Databases only appear when there are any: a
  // "0 databases" is noise in the one line a header can spare.
  // No count until there IS one: the head said "0 notes" while the folder was
  // still being read, and again when reading had failed (issue 104).
  const folderSummary = loading || failure !== null
    ? undefined
    : [
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
          <SwipeRow key={name} actions={swipeFor(target, "folder")}>
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
              ? <ChoiceMark multiple on={selected.has(b.path)} />
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
          <SwipeRow key={b.path} actions={swipeFor(b, "base")}>
            {row}
          </SwipeRow>
        );
      })}
      {shown.notes.map(noteRow)}

      {/* Attachments (S42). They were in the vault, synced and backed up, and
          no screen admitted they existed — a photo inserted into a note simply
          vanished from view. An image opens in the viewer; everything else is
          handed to the system, which knows what a PDF is and Plainva does not.
          A text file is the one kind of row here that is neither (C15, finding
          2026-10-08): the shared rule says it opens inside Plainva, and from a
          link, a bookmark or the search it did — only this list sent the same
          `.csv` to the share sheet. */}
      {shown.attachments.map((a) => (
        <Row
          icon={a.isImage
            ? <ImageIcon className="m-accent" size={ICON.ui} />
            : <Paperclip className="m-accent" size={ICON.ui} />}
          key={a.path}
          onClick={() => (resolveOpenAction(a.path) === "text" ? onOpenNote(a.path) : onOpenAttachment(a.path, a.isImage))}
          title={a.name}
        />
      ))}
      </RowList>
      </GroupCard>
      {/* Rule 6: every empty state explains itself and offers exactly one
          action. An empty folder used to be a blank screen with a plus button
          somewhere else — nothing said what belonged here. */}
      {/* Three named states, not one (issue 104). "Still reading" and "could
          not be read" used to render as "this folder is empty", because the
          listing starts empty and was only ever replaced on success. */}
      {loading && <p className="m-hint" role="status" data-testid="browse-loading">{t("mobile.folderLoading")}</p>}
      {!loading && failure !== null && (
        <EmptyState
          title={t("mobile.folderUnreadableTitle")}
          action={<Button onClick={() => setRefreshTick((n) => n + 1)} variant="primary" data-testid="browse-retry">{t("sync.retryNow")}</Button>}
          icon={<AlertTriangle size={ICON.empty} />}
        >
          {t("mobile.folderUnreadableBody")}
          <span className="m-hint" data-testid="browse-failure-reason">{failure}</span>
        </EmptyState>
      )}
      {onCreateNote &&
        !loading &&
        failure === null &&
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

      {sheetLayer}

      {/* The one sort sheet of the app (finding 2026-09-19): search hits and
          backlinks open the same component. */}
      {sortSheet && (
        <SortSheet
          testId="browse-sort-sheet"
          title={t("browse.sortBy")}
          options={(["title", "modified", "created"] as const).map((key) => ({
            key,
            label: t(key === "title" ? "browse.sortTitle" : key === "modified" ? "browse.sortModified" : "browse.sortCreated"),
          }))}
          active={sort.key}
          direction={t(sort.dir === "asc" ? "browse.sortAsc" : "browse.sortDesc")}
          ascending={sort.dir === "asc"}
          onChoose={chooseSort}
          onClose={() => setSortSheet(false)}
        />
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
