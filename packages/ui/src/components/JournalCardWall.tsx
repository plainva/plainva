import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { JournalEntry } from "@plainva/core";
import { distributeCards, pinboardColumnCount } from "../base/pinboardModel";
import { ICON } from "../lib/iconSizes";
import { formatJournalTime, newestFirst, type JournalDay } from "../lib/journalFeed";
import { parseNoteCard } from "../lib/noteCardModel";
import { AudioEmbed } from "./AudioEmbed";
import { NoteCardBody } from "./NoteCardBody";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";
import { TaskStateIcon } from "./TaskStateIcon";

/**
 * The journal as a wall of cards (plan Journal-Erweiterungen, X5/E4).
 *
 * The second way to read the same entries: the stream reads a day downwards,
 * the wall lets a week be scanned at a glance. Nothing new underneath — the
 * entries, the actions and the day order are the stream's; only the shape
 * differs, and the device remembers which shape it was last given.
 *
 * The columns come from the pinboard's own distribution (`distributeCards`),
 * which is height-balanced rather than round-robin, and the card body from the
 * same `NoteCardBody` the pinboard and the phone already draw. A card wall for
 * the journal is therefore wiring, not a second card renderer.
 *
 * A day break is a full-width rule ACROSS the columns, which is why each day
 * gets its own little wall: a divider inside a masonry column would sit at a
 * different height in every column and mean nothing.
 *
 * No pinning, no archive, no colour per card. That is a different product's
 * idea of a card; a day's entries have an order already, and it is the clock's.
 */
export interface JournalCardWallProps {
  days: readonly JournalDay[];
  todayKey: string;
  /** Reads a file of the vault; without it an embed stays out of the card. */
  loadMedia?: (path: string) => Promise<Blob>;
  onToggleTask: (day: JournalDay, entry: JournalEntry) => void;
  onOpenEntry: (day: JournalDay, entry: JournalEntry) => void;
  onMenu: (day: JournalDay, entry: JournalEntry, at: { x: number; y: number }) => void;
  /** The phone puts its swipe around a card. */
  wrapCard?: (day: JournalDay, entry: JournalEntry, element: ReactNode) => ReactNode;
  /** Narrower cards, for a phone. */
  compact?: boolean;
}

const CARD_WIDTH = 256;
const COMPACT_WIDTH = 168;
const GAP = 12;

/** One entry, as it stands on the wall. */
function EntryCard({ entry, day, loadMedia, onToggleTask, onOpenEntry, onMenu }: {
  entry: JournalEntry;
  day: JournalDay;
  loadMedia?: (path: string) => Promise<Blob>;
  onToggleTask: (day: JournalDay, entry: JournalEntry) => void;
  onOpenEntry: (day: JournalDay, entry: JournalEntry) => void;
  onMenu: (day: JournalDay, entry: JournalEntry, at: { x: number; y: number }) => void;
}) {
  const { t, i18n } = useTranslation();
  const card = useMemo(() => parseNoteCard(entry.text, { maxBlocks: 12 }), [entry.text]);
  const closed = entry.task === "done" || entry.task === "cancelled";

  return (
    <article
      className={cx("pv-journal-card", closed && "pv-journal-card--closed")}
      data-testid="journal-card"
      data-task={entry.task ?? undefined}
      onClick={() => onOpenEntry(day, entry)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(day, entry, { x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenEntry(day, entry); }
      }}
      role="button"
      tabIndex={0}
    >
      <header className="pv-journal-card-head">
        {entry.task && (
          <span className="pv-journal-box" onClick={(e) => e.stopPropagation()}>
            <IconButton
              label={closed ? t("tasks.open") : t("tasks.done")}
              onClick={() => onToggleTask(day, entry)}
              data-testid="journal-entry-toggle"
            >
              <TaskStateIcon state={entry.task} size={ICON.ui} />
            </IconButton>
          </span>
        )}
        <time className="pv-journal-time" dateTime={entry.time}>{formatJournalTime(entry, i18n.language)}</time>
      </header>
      <NoteCardBody
        blocks={card.blocks}
        labels={{ table: t("pinboard.phTable"), math: t("pinboard.phMath"), embed: t("pinboard.phEmbed") }}
        renderAudio={loadMedia ? (target, alt) => <CardSound target={target} label={alt} loadMedia={loadMedia} /> : undefined}
        renderImage={loadMedia ? (target, alt) => <CardPicture target={target} alt={alt} loadMedia={loadMedia} /> : undefined}
      />
    </article>
  );
}

/** A picture on a journal card; the candidates are the note's, resolved by the caller's reader. */
function CardPicture({ target, alt, loadMedia }: { target: string; alt: string; loadMedia: (path: string) => Promise<Blob> }) {
  const url = useVaultBlob(target, loadMedia);
  return url ? <img alt={alt} className="pv-journal-card-image" loading="lazy" src={url} /> : null;
}

/** A voice memo on a journal card. */
function CardSound({ target, label, loadMedia }: { target: string; label: string; loadMedia: (path: string) => Promise<Blob> }) {
  const url = useVaultBlob(target, loadMedia);
  return <AudioEmbed compact label={label || target} url={url} />;
}

/** One file of the vault as a blob URL, revoked when the card goes away. */
function useVaultBlob(path: string, loadMedia: (path: string) => Promise<Blob>): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(undefined);
    void loadMedia(path)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (alive) setUrl(null); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, loadMedia]);
  return url;
}

export function JournalCardWall({ days, todayKey, loadMedia, onToggleTask, onOpenEntry, onMenu, wrapCard, compact }: JournalCardWallProps) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    // jsdom has no ResizeObserver; the window fallback keeps the wall usable
    // there and in a WebView old enough to lack it.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardWidth = compact ? COMPACT_WIDTH : CARD_WIDTH;
  const columnCount = pinboardColumnCount(width, cardWidth, GAP);

  const heading = (day: JournalDay): string => {
    const year = day.key.slice(0, 4) !== todayKey.slice(0, 4) ? ({ year: "numeric" } as const) : {};
    const date = new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long", ...year }).format(day.date);
    return day.key === todayKey ? `${t("journal.today")} · ${date}` : date;
  };

  return (
    <div className="pv-journal-wall" data-testid="journal-cards" ref={hostRef}>
      {days.map((day) => {
        const entries = newestFirst(day.entries);
        // The distribution takes identities, not objects — one entry is one
        // line of one note, so its line number names it within the day.
        const ids = entries.map((entry) => String(entry.line));
        const byId = new Map(entries.map((entry) => [String(entry.line), entry]));
        const columns = distributeCards(ids, new Map(), columnCount);
        return (
          <section className="pv-journal-wall-day" data-day={day.key} data-testid="journal-day" key={day.path}>
            <h3 className="pv-journal-wall-head">{heading(day)}</h3>
            <div className="pv-journal-wall-cols" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, ${cardWidth}px))` }}>
              {columns.map((column, index) => (
                <div className="pv-journal-wall-col" key={index}>
                  {column.map((id) => {
                    const entry = byId.get(id);
                    if (!entry) return null;
                    const card = (
                      <EntryCard
                        day={day}
                        entry={entry}
                        loadMedia={loadMedia}
                        onMenu={onMenu}
                        onOpenEntry={onOpenEntry}
                        onToggleTask={onToggleTask}
                      />
                    );
                    return <Fragment key={id}>{wrapCard ? wrapCard(day, entry, card) : card}</Fragment>;
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

