import type { LucideIcon } from "lucide-react";
import {
  Ban, Bookmark, BookmarkMinus, CalendarPlus, CheckSquare, ClipboardCopy, Clock, Columns2, Copy, Database,
  ExternalLink, Eye, FolderInput, GitMerge, History, ListTree, Mail, MailOpen, Pencil, Repeat, Rows2, Square, Star, StarOff,
  Trash2, XCircle,
} from "lucide-react";

/**
 * One definition of what a row can do (Design-Runde Bedienung 2026-09-04, E2).
 *
 * The phone learned this in the redesign: a swipe, a hold sheet and a tap are
 * three WAYS to the same list, never three lists — two definitions of "what
 * this row can do" is exactly how a gesture and a menu come to disagree. The
 * desktop had the same problem in a different coat: a context menu, a selection
 * bar and a keyboard shortcut each carried their own idea of a row's actions.
 *
 * So the list lives here, once per row kind, and every surface on both shells
 * reads it: the desktop context menu, the desktop selection bar, the desktop
 * key handler, the mobile hold sheet and the mobile swipe. A surface may show a
 * SUBSET (the swipe keeps three, the bar keeps what works on many rows), but
 * the order and the words are the list's — `apps/desktop/src/interactionGrammar.test.ts`
 * fails a surface that invents an action the list does not know.
 *
 * The builders take the HANDLERS a surface has and build an entry only where
 * the handler exists (the `need` rule of the command registry): an action that
 * appears and does nothing is worse than one that is honestly absent.
 */
export interface RowActionSpec {
  /** Stable id — test ids and the parity guard hang on it, not on the label. */
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  run: () => void;
  /**
   * True for an action that makes sense on SEVERAL rows at once — the selection
   * bar and the bulk context menu keep these, and drop the rest.
   */
  bulk?: boolean;
  /**
   * True for the actions a swipe shows. A swipe has room for two or three, so
   * this is the row kind's own choice of the loud ones; the sheet shows all.
   */
  swipe?: boolean;
  /** Keyboard hint, in the palette's "Mod+…" spelling; only the desktop reads it. */
  shortcut?: string;
}

/** The translator shape both shells hand in (react-i18next's `t`). */
export type RowActionT = (key: string, opts?: Record<string, unknown>) => string;

/** Keeps the entries a surface asked for, in the list's own order. */
export function pickRowActions(list: RowActionSpec[], ids: string[]): RowActionSpec[] {
  const want = new Set(ids);
  return list.filter((a) => want.has(a.id));
}

/* ------------------------------------------------------------------ mail */

export interface MailRowCaps {
  /** Single row only: opening is what a tap does, so the sheet drops it. */
  open?: () => void;
  markRead?: () => void;
  markUnread?: () => void;
  /** The row's own flag state decides which of the two words appears. */
  flagged?: boolean;
  flag?: () => void;
  unflag?: () => void;
  move?: () => void;
  /** A snoozed row offers the way back; an ordinary one the way out. */
  snoozed?: boolean;
  snooze?: () => void;
  unsnooze?: () => void;
  /** "Spam" outside the junk folder, "Not spam" inside — the folder decides. */
  junkDirection?: "report" | "restore";
  junk?: () => void;
  /** In the trash the same entry deletes for good, and says so. */
  inTrash?: boolean;
  delete?: () => void;
}

export function mailRowActions(t: RowActionT, c: MailRowCaps): RowActionSpec[] {
  const out: Array<RowActionSpec | null> = [
    c.open ? { id: "open", label: t("mail.open", { defaultValue: "Öffnen" }), icon: MailOpen, run: c.open } : null,
    c.markRead ? { id: "read", label: t("mail.markRead", { defaultValue: "Als gelesen markieren" }), icon: MailOpen, run: c.markRead, bulk: true } : null,
    c.markUnread ? { id: "unread", label: t("mail.markUnread", { defaultValue: "Als ungelesen markieren" }), icon: Mail, run: c.markUnread, bulk: true } : null,
    c.flagged && c.unflag
      ? { id: "unflag", label: t("mail.unflag", { defaultValue: "Markierung entfernen" }), icon: StarOff, run: c.unflag, bulk: true }
      : c.flag
        ? { id: "flag", label: t("mail.flag", { defaultValue: "Markieren" }), icon: Star, run: c.flag, bulk: true }
        : null,
    c.move ? { id: "move", label: t("mail.moveTo", { defaultValue: "Verschieben nach…" }), icon: FolderInput, run: c.move, bulk: true } : null,
    c.snoozed && c.unsnooze
      ? { id: "unsnooze", label: t("mail.unsnooze", { defaultValue: "Jetzt zurückholen" }), icon: Clock, run: c.unsnooze, bulk: true, swipe: true }
      : c.snooze
        ? { id: "snooze", label: t("mail.snooze", { defaultValue: "Zurückstellen…" }), icon: Clock, run: c.snooze, bulk: true, swipe: true }
        : null,
    c.junk
      ? {
          id: "junk",
          label: c.junkDirection === "restore" ? t("mail.notJunk", { defaultValue: "Kein Spam" }) : t("mail.reportJunk", { defaultValue: "Spam" }),
          icon: Ban,
          run: c.junk,
          bulk: true,
          swipe: true,
        }
      : null,
    c.delete
      ? {
          id: "delete",
          label: c.inTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" }),
          icon: Trash2,
          danger: true,
          run: c.delete,
          bulk: true,
          swipe: true,
          shortcut: "Delete",
        }
      : null,
  ];
  return out.filter((a): a is RowActionSpec => a !== null);
}

/* ------------------------------------------------------------------ task */

export interface TaskRowCaps {
  done: boolean;
  toggle?: () => void;
  /** Note task → the task database. */
  promote?: () => void;
  /** Database task: the repeat rule. */
  repeat?: () => void;
  /** Blocks time for it in a calendar. */
  block?: () => void;
}

export function taskRowActions(t: RowActionT, c: TaskRowCaps): RowActionSpec[] {
  const out: Array<RowActionSpec | null> = [
    c.toggle
      ? {
          id: "toggle",
          label: c.done ? t("tasks.open", { defaultValue: "Offen" }) : t("tasks.done", { defaultValue: "Erledigt" }),
          icon: c.done ? Square : CheckSquare,
          run: c.toggle,
          bulk: true,
          swipe: true,
        }
      : null,
    c.promote ? { id: "promote", label: t("tasks.promoteTo", { defaultValue: "In Datenbank verschieben" }), icon: Database, run: c.promote, swipe: true } : null,
    c.repeat ? { id: "repeat", label: t("tasks.repeat", { defaultValue: "Wiederholung" }), icon: Repeat, run: c.repeat } : null,
    c.block ? { id: "block", label: t("pim.blockTime", { defaultValue: "Zeit blocken" }), icon: CalendarPlus, run: c.block, swipe: true } : null,
  ];
  return out.filter((a): a is RowActionSpec => a !== null);
}

/* ------------------------------------------------------------------ file */

export interface FileRowCaps {
  isFolder?: boolean;
  /** Desktop only: a second pane. The phone has one, and simply never passes these. */
  openNewTab?: () => void;
  openSplitRight?: () => void;
  openSplitDown?: () => void;
  rename?: () => void;
  duplicate?: () => void;
  move?: () => void;
  /**
   * Bookmark: a shell that knows the state names the direction; one that does
   * not (the phone's sheet) offers the toggle by its plain name.
   */
  bookmarked?: boolean;
  bookmark?: () => void;
  /** Folder only: the overview note (`index.md`). `overviewExists` picks "refresh" over "create". */
  overview?: () => void;
  overviewExists?: boolean;
  versionHistory?: () => void;
  resolveConflict?: () => void;
  reveal?: () => void;
  copyPath?: () => void;
  removeFromList?: () => void;
  delete?: () => void;
}

export function fileRowActions(t: RowActionT, c: FileRowCaps): RowActionSpec[] {
  const bookmarkLabel =
    c.bookmarked === undefined
      ? t("mobile.toggleBookmark", { defaultValue: "Lesezeichen" })
      : c.bookmarked
        ? t("editor.removeBookmark", { defaultValue: "Lesezeichen entfernen" })
        : t("editor.addBookmark", { defaultValue: "Lesezeichen hinzufügen" });
  const out: Array<RowActionSpec | null> = [
    c.openNewTab ? { id: "openNewTab", label: t("fileTree.openNewTab", { defaultValue: "In neuem Tab öffnen" }), icon: ExternalLink, run: c.openNewTab } : null,
    c.openSplitRight ? { id: "openSplitRight", label: t("fileTree.openSplitRight", { defaultValue: "Im Split öffnen (rechts)" }), icon: Columns2, run: c.openSplitRight } : null,
    c.openSplitDown ? { id: "openSplitDown", label: t("fileTree.openSplitDown", { defaultValue: "Im Split öffnen (unten)" }), icon: Rows2, run: c.openSplitDown } : null,
    c.rename ? { id: "rename", label: t("common.rename", { defaultValue: "Umbenennen" }), icon: Pencil, run: c.rename, shortcut: "F2" } : null,
    c.duplicate ? { id: "duplicate", label: t("fileTree.duplicate", { defaultValue: "Duplizieren" }), icon: Copy, run: c.duplicate, bulk: true } : null,
    c.move ? { id: "move", label: t("fileTree.moveTo", { defaultValue: "Verschieben nach…" }), icon: FolderInput, run: c.move, bulk: true } : null,
    c.overview
      ? {
          id: "overview",
          label: c.overviewExists
            ? t("indexMd.refreshOverview", { defaultValue: "Übersicht aktualisieren" })
            : t("indexMd.createOverview", { defaultValue: "Übersicht erzeugen" }),
          icon: ListTree,
          run: c.overview,
        }
      : null,
    // The swipe on a note keeps the bookmark and the delete: the two a thumb
    // reaches for most, and what the phone showed before the list existed.
    c.bookmark ? { id: "bookmark", label: bookmarkLabel, icon: c.bookmarked ? BookmarkMinus : Bookmark, run: c.bookmark, swipe: true } : null,
    c.versionHistory ? { id: "versionHistory", label: t("fileTree.versionHistory", { defaultValue: "Versionsverlauf…" }), icon: History, run: c.versionHistory } : null,
    c.resolveConflict ? { id: "resolveConflict", label: t("conflict.resolveAction", { defaultValue: "Konflikt lösen…" }), icon: GitMerge, run: c.resolveConflict } : null,
    c.reveal ? { id: "reveal", label: t("editor.revealInTree", { defaultValue: "Im Dateibaum anzeigen" }), icon: Eye, run: c.reveal } : null,
    c.copyPath ? { id: "copyPath", label: t("fileTree.copyPath", { defaultValue: "Pfad kopieren" }), icon: ClipboardCopy, run: c.copyPath } : null,
    c.removeFromList ? { id: "removeFromList", label: t("fileTree.removeFromList", { defaultValue: "Aus der Liste entfernen" }), icon: XCircle, run: c.removeFromList } : null,
    c.delete
      ? { id: "delete", label: t("common.delete", { defaultValue: "Löschen" }), icon: Trash2, danger: true, run: c.delete, bulk: true, swipe: true, shortcut: "Delete" }
      : null,
  ];
  return out.filter((a): a is RowActionSpec => a !== null);
}

/**
 * The ids each row kind can carry, in the list's order — what the parity
 * guard reads, so it does not have to build a list with fake handlers.
 */
export const ROW_ACTION_IDS = {
  mail: ["open", "read", "unread", "flag", "unflag", "move", "snooze", "unsnooze", "junk", "delete"],
  task: ["toggle", "promote", "repeat", "block"],
  file: [
    "openNewTab", "openSplitRight", "openSplitDown", "rename", "duplicate", "move", "overview", "bookmark", "versionHistory",
    "resolveConflict", "reveal", "copyPath", "removeFromList", "delete",
  ],
} as const;
