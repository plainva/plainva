import { Fragment, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Ellipsis, FileText } from "lucide-react";
import type { JournalEntry } from "@plainva/core";
import { resolveCoverSource } from "../base/coverImage";
import { ICON } from "../lib/iconSizes";
import { findMediaEmbeds, imageCandidates } from "../lib/imageTarget";
import { renderInlineMarkdown, type InlineLinkHandlers } from "../lib/inlineMarkdown";
import { addDaysToKey } from "../lib/taskPlanner";
import { formatJournalTime, newestFirst, type JournalDay } from "../lib/journalFeed";
import { AudioEmbed } from "./AudioEmbed";
import { boundaryLabel } from "../lib/today";
import { Rating } from "./ui/Rating";
import { useDayBoundaryMinutes } from "../hooks/useTodayKey";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";
import { GroupCard, Row, RowList, SectionLabel } from "./ui/GroupedRows";
import { IconButton } from "./ui/IconButton";
import { TaskStateIcon } from "./TaskStateIcon";

/**
 * The days of the journal stream (plan Journal, J5), drawn the same way in both
 * shells: a heading per day with its count and the way into the note, the
 * entries of the day with the newest on top.
 *
 * An entry is Markdown and is drawn by the shared inline renderer — links open,
 * tags are pills. An embedded image shows as a preview instead of its syntax;
 * the shell says how a vault path becomes a picture (`loadImage`).
 *
 * What an entry can DO stays with the shell: `onMenu` is the desktop's context
 * menu and both shells' "more" button, `wrapRow` lets the phone put its swipe
 * around a row, `renderEditor` replaces the row that is being edited.
 */
export interface JournalDayListProps {
  days: readonly JournalDay[];
  todayKey: string;
  links?: InlineLinkHandlers;
  /** Reads an image of the vault; without it an embed stays out of the row. */
  loadImage?: (path: string) => Promise<Blob>;
  onToggleTask: (day: JournalDay, entry: JournalEntry) => void;
  onOpenNote: (day: JournalDay) => void;
  /** A tap on the row itself. */
  onOpenEntry: (day: JournalDay, entry: JournalEntry) => void;
  onMenu: (day: JournalDay, entry: JournalEntry, at: { x: number; y: number }) => void;
  /** The entry that is being edited, and what stands in its place. */
  editing?: { path: string; line: number } | null;
  renderEditor?: (day: JournalDay, entry: JournalEntry) => ReactNode;
  wrapRow?: (day: JournalDay, entry: JournalEntry, element: ReactElement) => ReactNode;
  rowProps?: (day: JournalDay, entry: JournalEntry) => Omit<HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">;
  /** Without the day headings — the "journal of this day" section brings its own. */
  headless?: boolean;
  /** The phone's day heading: a short date and no count, so it stays one line beside "open note". */
  compact?: boolean;
  /**
   * The narrow column of the right sidebar (finding 2026-09-22).
   *
   * One line per entry and nothing to operate: no "more" menu, no box to tick.
   * Every row starts on the SAME text edge — a box in front of some rows and
   * not others made the column look broken — and a task says so with a quiet
   * mark on the trailing edge; a closed one is struck through. Ticking happens
   * in the journal tab or in the note, where the target is finger-sized: a
   * 13-px box in a 250-px column is a misclick waiting to happen.
   */
  slim?: boolean;
  /**
   * Sets the day's rating (plan Journal-Erweiterungen, X6). Absent = the marks
   * are shown but not pressable; a day carries no rating at all when the vault
   * names no mood property, and then nothing is drawn.
   */
  onSetMood?: (day: JournalDay, value: number) => void;
}

/** Entries longer than this are folded; "More" opens them. */
const FOLD_CHARS = 420;
const FOLD_LINES = 6;

/** The text without its media embeds, and the embeds - pictures and sound apart (X3). */
function splitMedia(text: string): { prose: string; images: string[]; sounds: string[] } {
  const embeds = findMediaEmbeds(text);
  if (embeds.length === 0) return { prose: text, images: [], sounds: [] };
  let prose = "";
  let at = 0;
  for (const embed of embeds) {
    prose += text.slice(at, embed.start);
    at = embed.end;
  }
  prose += text.slice(at);
  const spell = (e: (typeof embeds)[number]) => (e.syntax === "wiki" ? `![[${e.target}]]` : e.target);
  return {
    prose: prose.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    images: embeds.filter((e) => e.kind === "image").map(spell),
    sounds: embeds.filter((e) => e.kind === "audio").map((e) => e.target),
  };
}

function EntryText({ text, links }: { text: string; links?: InlineLinkHandlers }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // The shared renderer builds DOM (no innerHTML); React owns only the span.
    ref.current?.replaceChildren(renderInlineMarkdown(text, links ?? {}));
  }, [text, links]);
  return <span ref={ref} className="pv-journal-text" />;
}

function EntryImage({ raw, notePath, loadImage }: { raw: string; notePath: string; loadImage: (path: string) => Promise<Blob> }) {
  const source = resolveCoverSource(raw, notePath);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const candidateKey = source?.kind === "vault" ? source.candidates.join("|") : null;
  useEffect(() => {
    if (!candidateKey) return;
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      for (const path of candidateKey.split("|")) {
        try {
          const blob = await loadImage(path);
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
          return;
        } catch {
          /* try the next candidate */
        }
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [candidateKey, loadImage]);
  const src = source?.kind === "url" ? source.url : blobUrl;
  return src ? <img className="pv-journal-image" src={src} alt="" loading="lazy" /> : null;
}

function EntrySound({ target, notePath, loadImage }: { target: string; notePath: string; loadImage: (path: string) => Promise<Blob> }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const candidateKey = imageCandidates(target, { notePath }).join("|");
  useEffect(() => {
    if (!candidateKey) { setUrl(null); return; }
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(undefined);
    void (async () => {
      for (const path of candidateKey.split("|")) {
        try {
          const blob = await loadImage(path);
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        } catch {
          /* try the next candidate */
        }
      }
      if (alive) setUrl(null);
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [candidateKey, loadImage]);
  return <AudioEmbed url={url} label={target.split("/").pop() ?? target} compact />;
}

function EntryBody({ entry, notePath, links, loadImage }: { entry: JournalEntry; notePath: string; links?: InlineLinkHandlers; loadImage?: (path: string) => Promise<Blob> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { prose, images, sounds } = splitMedia(entry.text);
  const long = prose.length > FOLD_CHARS || prose.split("\n").length > FOLD_LINES;
  return (
    <span className="pv-journal-body">
      <span className={long && !open ? "pv-journal-fold" : undefined}>
        <EntryText text={prose} links={links} />
      </span>
      {long && (
        <Button variant="ghost" size="sm" onClick={() => setOpen((x) => !x)} data-testid="journal-entry-more">
          {open ? t("journal.showLess") : t("journal.showMore")}
        </Button>
      )}
      {loadImage && images.length > 0 && (
        <span className="pv-journal-images">
          {images.map((raw, i) => <EntryImage key={`${raw}@${i}`} raw={raw} notePath={notePath} loadImage={loadImage} />)}
        </span>
      )}
      {loadImage && sounds.length > 0 && (
        <span className="pv-journal-sounds">
          {sounds.map((target, i) => <EntrySound key={`${target}@${i}`} target={target} notePath={notePath} loadImage={loadImage} />)}
        </span>
      )}
    </span>
  );
}

/** The entry's minute as `HH:mm` — what `<time>` wants, whatever way the note spells it (`9:05`, `14:05:30`). */
function clockOf(entry: Pick<JournalEntry, "seconds">): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(entry.seconds / 3600))}:${two(Math.floor(entry.seconds / 60) % 60)}`;
}

export function JournalDayList({ days, todayKey, links, loadImage, onToggleTask, onOpenNote, onOpenEntry, onMenu, onSetMood, editing, renderEditor, wrapRow, rowProps, headless, compact, slim }: JournalDayListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const yesterdayKey = addDaysToKey(todayKey, -1);

  // "until 04:00" on the day that is still collecting entries (plan X2). Only
  // there: it says where a line written after midnight goes, which is a fact
  // about NOW, not about a day three weeks back.
  const boundary = useDayBoundaryMinutes();
  const boundaryNote = boundary > 0 ? t("journal.untilBoundary", { time: boundaryLabel(boundary) }) : null;

  /** The day's rating, where the vault rates days at all. */
  const moodOf = (day: JournalDay) =>
    day.mood === undefined ? null : (
      <Rating
        className="pv-journal-day-mood"
        label={t("journal.mood")}
        onChange={onSetMood ? (next) => onSetMood(day, next) : undefined}
        value={day.mood ?? 0}
      />
    );

  const heading = (day: JournalDay): string => {
    const year = day.key.slice(0, 4) !== todayKey.slice(0, 4) ? ({ year: "numeric" } as const) : {};
    const date = new Intl.DateTimeFormat(locale, compact || slim ? { weekday: "short", day: "2-digit", month: "2-digit", ...year } : { weekday: "long", day: "numeric", month: "long", ...year }).format(day.date);
    const name = day.key === todayKey ? t("journal.today") : day.key === yesterdayKey ? t("journal.yesterday") : null;
    return name ? `${name} · ${date}` : date;
  };

  if (slim) {
    return (
      <div className="pv-journal-slim" data-testid="journal-days">
        {days.map((day) => (
          <section key={day.path} data-testid="journal-day" data-day={day.key}>
            {!headless && (
              <SectionLabel end={moodOf(day)}>
                {heading(day)}
                {boundaryNote && day.key === todayKey && <> <span className="pv-journal-count">· {boundaryNote}</span></>}
              </SectionLabel>
            )}
            {newestFirst(day.entries).map((entry) => {
              const closed = entry.task === "done" || entry.task === "cancelled";
              return (
                <div
                  key={`${entry.line}:${entry.source[0]}`}
                  className={cx("pv-journal-slim-row", closed && "pv-journal-slim-row--closed")}
                  role="button"
                  tabIndex={0}
                  data-testid="journal-entry"
                  data-task={entry.task ?? undefined}
                  onClick={() => onOpenEntry(day, entry)}
                  // Only the row itself answers the keyboard; a link inside it keeps its own.
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenEntry(day, entry); }
                  }}
                  onContextMenu={(e) => { e.preventDefault(); onMenu(day, entry, { x: e.clientX, y: e.clientY }); }}
                >
                  <time className="pv-journal-time" dateTime={clockOf(entry)}>{formatJournalTime(entry, locale)}</time>
                  <EntryText text={splitMedia(entry.text).prose} links={links} />
                  {entry.task && (
                    <span
                      className={cx("pv-journal-mark", closed && "pv-journal-mark--closed")}
                      role="img"
                      aria-label={t(closed ? "journal.markDone" : "journal.markOpen")}
                    >
                      {closed && <Check size={ICON.meta} />}
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="pv-journal-days" data-testid="journal-days">
      {days.map((day) => (
        <section key={day.path} data-testid="journal-day" data-day={day.key}>
          {!headless && <SectionLabel
            end={
              <>
                {moodOf(day)}
                <Button variant="ghost" size="sm" icon={<FileText size={ICON.meta} />} onClick={() => onOpenNote(day)} data-testid="journal-open-note">
                  {t("journal.openNote")}
                </Button>
              </>
            }
          >
            {heading(day)}{!compact && <> <span className="pv-journal-count">· {t("journal.entries", { count: day.entries.length })}</span></>}
            {boundaryNote && day.key === todayKey && <> <span className="pv-journal-count">· {boundaryNote}</span></>}
          </SectionLabel>}
          <GroupCard>
            <RowList>
              {newestFirst(day.entries).map((entry) => {
                const key = `${entry.line}:${entry.source[0]}`;
                if (editing && editing.path === day.path && editing.line === entry.line && renderEditor) {
                  return <div key={key} className="pv-journal-editing" data-testid="journal-entry-editing">{renderEditor(day, entry)}</div>;
                }
                const closed = entry.task === "done" || entry.task === "cancelled";
                const element = (
                  <Row
                    wrap
                    controls
                    className="pv-journal-row"
                    data-testid="journal-entry"
                    data-task={entry.task ?? undefined}
                    onContextMenu={(e) => { e.preventDefault(); onMenu(day, entry, { x: e.clientX, y: e.clientY }); }}
                    {...rowProps?.(day, entry)}
                    /* One line: the time as a column down the day, the box of a task
                       entry in front of its text — as the note itself reads. */
                    title={
                      <span className={closed ? "pv-journal-line pv-planner-closed" : "pv-journal-line"}>
                        <time className="pv-journal-time" dateTime={clockOf(entry)}>{formatJournalTime(entry, locale)}</time>
                        {entry.task && (
                          <span className="pv-journal-box">
                            <IconButton label={closed ? t("tasks.open") : t("tasks.done")} onClick={() => onToggleTask(day, entry)} data-testid="journal-entry-toggle">
                              <TaskStateIcon state={entry.task} size={ICON.ui} />
                            </IconButton>
                          </span>
                        )}
                        <EntryBody entry={entry} notePath={day.path} links={links} loadImage={loadImage} />
                      </span>
                    }
                    end={
                      <IconButton
                        label={t("common.moreActions")}
                        onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); onMenu(day, entry, { x: box.left, y: box.bottom }); }}
                        data-testid="journal-entry-menu"
                      >
                        <Ellipsis size={ICON.ui} />
                      </IconButton>
                    }
                    onClick={() => onOpenEntry(day, entry)}
                  />
                );
                return <Fragment key={key}>{wrapRow ? wrapRow(day, entry, element) : element}</Fragment>;
              })}
            </RowList>
          </GroupCard>
        </section>
      ))}
    </div>
  );
}
