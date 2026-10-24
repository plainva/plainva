import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Info, ListChecks, MoreHorizontal, Pause, Play, Unlink } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { MenuItem, MenuSurface } from "../components/ui/Menu";
import { toast } from "../services/toastStore";
import { ICON } from "../lib/iconSizes";
import type { AiSession, NoteHintItem, NoteHintsAnswer } from "./aiSession";
import type { RelatedJump } from "./relatedNotesModel";
import { routineClock } from "./routineView";

/**
 * Calm hints at the open note (plan KI-Harness P8-3, mockup chapter 25): what
 * the device notices by itself, without a model — at most three, each with
 * the one step the app already knows, "Why this hint?" and "Don't show
 * again". The desktop's section after "Related", a tab of the phone's note
 * sheet; the same list in both shells, in the grammar of the related notes.
 */

/** Waits this long after the last change of the text before asking: typing asks once it rests. */
const SETTLE_MS = 150;
const NOOP = () => () => {};

/**
 * The hints of the open note, asked again when its text changes, when what is
 * hidden or paused changes, and when one of the two switches they stand
 * behind — the AI, the hints — is turned: switched off, a section that showed
 * hints kept them.
 */
export function useNoteHints(session: AiSession | null, path: string | null, content: string | null): NoteHintsAnswer | null {
  const version = useSyncExternalStore(session ? session.subscribe : NOOP, () => {
    if (!session) return "";
    const { hints, settings } = session.getState();
    return `${hints.version}:${settings.enabled ? 1 : 0}:${settings.noteHints ? 1 : 0}`;
  });
  const [answer, setAnswer] = useState<{ path: string; answer: NoteHintsAnswer } | null>(null);
  useEffect(() => {
    if (!session || !path || content === null || !/\.md$/i.test(path)) return;
    let alive = true;
    const timer = setTimeout(() => {
      void session.noteHints(path, content).then(
        (found) => alive && setAnswer({ path, answer: found }),
        () => alive && setAnswer({ path, answer: { kind: "off" } }),
      );
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session, path, content, version]);
  return answer && answer.path === path ? answer.answer : null;
}

/** How many hints a surface shows (the section's count, whether it has content). */
export function noteHintsCount(answer: NoteHintsAnswer | null): number {
  return answer?.kind === "hints" ? answer.items.length : 0;
}

function hintTitle(t: (key: string, vars?: Record<string, unknown>) => string, item: NoteHintItem, locale: string): string {
  if (item.kind === "link") return t("ai.hints.link", { link: item.subject });
  if (item.kind === "todo") return t("ai.hints.todo", { text: item.subject });
  const start = item.event ? new Date(item.event.start.ts) : null;
  const time = item.event?.allDay || !start ? "" : routineClock(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`, locale);
  return t("ai.hints.meeting", { time, title: item.subject }).replace(/\s{2,}/g, " ");
}

function hintLine(t: (key: string, vars?: Record<string, unknown>) => string, item: NoteHintItem): string {
  if (item.kind === "link") return t("ai.hints.line", { line: item.line ?? 1 });
  if (item.kind === "todo") return t("ai.hints.todoLine", { line: item.line ?? 1 });
  return t("ai.hints.meetingLine");
}

export function NoteHintsList({
  session,
  path,
  answer,
  onOpenNote,
  onJump,
  showStates = false,
}: {
  session: AiSession;
  /** The open note. */
  path: string;
  answer: NoteHintsAnswer | null;
  onOpenNote: (path: string) => void;
  onJump: (jump: RelatedJump) => void;
  /** Say why there are no hints (the phone's tab); the desktop's section disappears instead. */
  showStates?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!answer) return null;
  if (answer.kind === "paused") {
    return (
      <div className="pv-related-state" data-testid="hints-state">
        <span>{t("ai.hints.notePaused")}</span>
        <Button variant="ghost" size="sm" onClick={() => void session.resumeNoteHints(path)} data-testid="hints-resume-note">
          {t("ai.hints.resumeNote")}
        </Button>
      </div>
    );
  }
  if (answer.kind !== "hints" || answer.items.length === 0) {
    if (!showStates) return null;
    const state = answer.kind === "vaultPaused" ? t("ai.hints.vaultPaused") : answer.kind === "hints" ? t("ai.hints.none") : null;
    return state ? (
      <p className="pv-related-state" data-testid="hints-state">
        {state}
      </p>
    ) : null;
  }
  const act = (item: NoteHintItem) => {
    setBusy(item.key);
    void session
      .actOnNoteHint(path, item)
      .then((outcome) => {
        // "done" says nothing: the line changed in the note, and its editor shows it (the host tells it).
        if (outcome.kind === "opened") onOpenNote(outcome.path);
        else if (outcome.kind === "gone") toast.info(t("ai.hints.todoGone"));
        else if (outcome.kind === "failed") toast.error(t("ai.hints.failed"));
      })
      .finally(() => setBusy(null));
  };
  return (
    <ul className="pv-related" data-testid="hints-list">
      {answer.items.map((item) => {
        const open = why === item.key;
        const icon = item.kind === "link" ? <Unlink size={ICON.meta} /> : item.kind === "todo" ? <ListChecks size={ICON.meta} /> : <CalendarClock size={ICON.meta} />;
        const jump = item.line !== null ? () => onJump({ path, line: item.line!, term: item.subject }) : () => setWhy(open ? null : item.key);
        const label = item.kind === "link" ? t("ai.hints.linkAct") : item.kind === "todo" ? t("ai.hints.todoAct") : t("ai.hints.meetingAct");
        const whyText = item.kind === "link" ? t("ai.hints.linkWhy", { line: item.line ?? 1 }) : item.kind === "todo" ? t("ai.hints.todoWhy", { line: item.line ?? 1, text: item.subject }) : t("ai.hints.meetingWhy");
        return (
          <li key={item.key} className="pv-related-row" data-open={open || undefined} data-testid="hints-row" data-kind={item.kind}>
            <div className="pv-related-head">
              <Button variant="ghost" size="sm" icon={icon} className="pv-related-main" onClick={jump}>
                <span className="pv-related-title">{hintTitle(t, item, i18n.language)}</span>
              </Button>
              <IconButton size="sm" label={t("ai.hints.why")} active={open} onClick={() => setWhy(open ? null : item.key)} data-testid="hints-why">
                <Info size={ICON.meta} />
              </IconButton>
            </div>
            <span className="pv-related-ctx">{hintLine(t, item)}</span>
            <span className="pv-related-actions">
              <Button variant="tonal" size="sm" disabled={busy !== null} onClick={() => act(item)} data-testid="hints-act">
                {label}
              </Button>
            </span>
            {open && (
              <div className="pv-related-why" data-testid="hints-why-panel">
                <strong>{t("ai.hints.why")}</strong>
                <span>{whyText}</span>
                <span className="pv-related-facts">{t("ai.hints.onDevice")}</span>
                <span className="pv-related-actions">
                  {item.line !== null && (
                    <Button variant="ghost" size="sm" onClick={jump}>
                      {t("ai.hints.toLine")}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void session.dismissNoteHint(item.key)} data-testid="hints-dismiss">
                    {t("ai.hints.dismiss")}
                  </Button>
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The pause for a note and for the vault: a menu in the desktop section's head. */
export function NoteHintsMenu({ session, path, answer }: { session: AiSession; path: string; answer: NoteHintsAnswer | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const paused = answer?.kind === "paused";
  return (
    <>
      <IconButton ref={anchor} size="sm" label={t("ai.hints.menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="hints-menu">
        <MoreHorizontal size={ICON.meta} />
      </IconButton>
      <MenuSurface open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="right" ariaLabel={t("ai.hints.menu")}>
        {paused ? (
          <MenuItem icon={<Play size={ICON.ui} />} onSelect={() => void session.resumeNoteHints(path)}>
            {t("ai.hints.resumeNote")}
          </MenuItem>
        ) : (
          <MenuItem icon={<Pause size={ICON.ui} />} onSelect={() => void session.pauseNoteHints(path)} data-testid="hints-pause-note">
            {t("ai.hints.pauseNote")}
          </MenuItem>
        )}
        <MenuItem icon={<Pause size={ICON.ui} />} onSelect={() => void session.setNoteHintsVaultPaused(true)} data-testid="hints-pause-vault">
          {t("ai.hints.pauseVault")}
        </MenuItem>
      </MenuSurface>
    </>
  );
}

/** The same pause on the phone: plain buttons under the tab's list. */
export function NoteHintsActions({ session, path, answer }: { session: AiSession; path: string; answer: NoteHintsAnswer | null }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!answer || answer.kind === "off") return null;
  const run = (work: Promise<void>) => {
    setBusy(true);
    void work.finally(() => setBusy(false));
  };
  return (
    <div className="pv-related-pause">
      {answer.kind === "vaultPaused" ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(session.setNoteHintsVaultPaused(false))} data-testid="hints-resume-vault">
          {t("ai.hints.resumeVault")}
        </Button>
      ) : (
        <>
          {answer.kind !== "paused" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(session.pauseNoteHints(path))} data-testid="hints-pause-note">
              {t("ai.hints.pauseNote")}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(session.setNoteHintsVaultPaused(true))} data-testid="hints-pause-vault">
            {t("ai.hints.pauseVault")}
          </Button>
        </>
      )}
    </div>
  );
}
