import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Info, MoreHorizontal, Pause, Play } from "lucide-react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { MenuItem, MenuSurface } from "../components/ui/Menu";
import { ICON } from "../lib/iconSizes";
import { useLocalEmbeddings } from "./SemanticSearch";
import {
  relatedFactsLine,
  relatedFromLine,
  relatedPairLine,
  relatedStateLine,
  relatedToLine,
  type RelatedAnswer,
  type RelatedJump,
} from "./relatedNotesModel";

/**
 * Related notes (plan KI-Harness P2b-4, mockup chapter 11, Design Language
 * "Related notes"): at most three notes close in meaning to the open one and
 * not linked with it yet — the desktop's section after the backlinks, a tab
 * of the phone's note sheet. Each names its pair of sections; "Why?" shows
 * them with their first words (a tap jumps there), the links both notes set
 * and that it was computed on this device; "Not helpful" hides exactly that
 * pair. The same list in both shells.
 */

/** Waits this long after the last change before asking: switching through notes asks for the last one only. */
const SETTLE_MS = 150;

/**
 * The answer for one note, asked again when the note changes, when a run of
 * the pipeline ends (its vectors may be current now), and when the setting or
 * the reader's word changed — not for every note a first run embeds.
 */
export function useRelatedNotes(path: string | null): RelatedAnswer | null {
  const { controller, state } = useLocalEmbeddings();
  const [answer, setAnswer] = useState<{ path: string; answer: RelatedAnswer } | null>(null);
  const ready = state?.engine.kind === "ready";
  const settled = state && state.progress.state !== "working" ? state.progress.current : -1;
  const version = state?.related.version ?? 0;
  useEffect(() => {
    if (!controller || !path || !/\.md$/i.test(path)) return;
    let alive = true;
    const timer = setTimeout(() => {
      void controller.related(path).then(
        (found) => alive && setAnswer({ path, answer: found }),
        () => alive && setAnswer({ path, answer: { kind: "off" } }),
      );
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [controller, path, ready, settled, version]);
  return answer && answer.path === path ? answer.answer : null;
}

/** How many hints a surface shows for the answer (the section's count, whether it has content). */
export function relatedCount(answer: RelatedAnswer | null): number {
  return answer?.kind === "hints" ? answer.hints.length : 0;
}

export function RelatedNotesList({
  path,
  answer,
  onOpenNote,
  onJump,
  showStates = false,
}: {
  /** The open note. */
  path: string;
  answer: RelatedAnswer | null;
  onOpenNote: (path: string) => void;
  onJump: (jump: RelatedJump) => void;
  /** Say why there are no hints (the phone's tab); the desktop's section disappears instead (plan E6). */
  showStates?: boolean;
}) {
  const { t } = useTranslation();
  const { controller } = useLocalEmbeddings();
  const [why, setWhy] = useState<string | null>(null);
  if (!answer) return null;
  const state = relatedStateLine(t, answer);
  if (state !== null) {
    // A paused note says so in every shell: it is where the pause is lifted.
    if (answer.kind === "paused") {
      return (
        <div className="pv-related-state" data-testid="related-state">
          <span>{state}</span>
          <Button variant="ghost" size="sm" onClick={() => void controller?.resumeRelated(path)} data-testid="related-resume-note">
            {t("ai.related.resumeNote")}
          </Button>
        </div>
      );
    }
    return showStates ? (
      <p className="pv-related-state" data-testid="related-state">
        {state}
      </p>
    ) : null;
  }
  if (answer.kind !== "hints") return null;
  return (
    <ul className="pv-related" data-testid="related-list">
      {answer.hints.map((hint) => {
        const open = why === hint.path;
        return (
          <li key={hint.path} className="pv-related-row" data-open={open || undefined}>
            <div className="pv-related-head">
              <Button variant="ghost" size="sm" icon={<FileText size={ICON.meta} />} className="pv-related-main" onClick={() => onOpenNote(hint.path)} data-testid="related-row">
                <span className="pv-related-title">{hint.title}</span>
              </Button>
              <IconButton size="sm" label={t("ai.related.why")} active={open} onClick={() => setWhy(open ? null : hint.path)} data-testid="related-why">
                <Info size={ICON.meta} />
              </IconButton>
            </div>
            <span className="pv-related-ctx">{relatedPairLine(t, hint)}</span>
            {open && (
              <div className="pv-related-why" data-testid="related-why-panel">
                <strong>{t("ai.related.why")}</strong>
                <Button variant="ghost" size="sm" className="pv-related-quote" onClick={() => onJump({ path, line: hint.from.line, term: hint.from.lineText })}>
                  {relatedFromLine(t, hint)}
                </Button>
                <Button variant="ghost" size="sm" className="pv-related-quote" onClick={() => onJump({ path: hint.path, line: hint.to.line, term: hint.to.lineText })}>
                  {relatedToLine(t, hint)}
                </Button>
                <span className="pv-related-facts">{relatedFactsLine(t, hint)}</span>
                <span className="pv-related-actions">
                  <Button variant="ghost" size="sm" onClick={() => onOpenNote(hint.path)}>
                    {t("ai.related.open")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void controller?.dismissRelated(path, hint.path)} data-testid="related-dismiss">
                    {t("ai.related.dismiss")}
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
export function RelatedNotesMenu({ path, answer }: { path: string; answer: RelatedAnswer | null }) {
  const { t } = useTranslation();
  const { controller } = useLocalEmbeddings();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!controller) return null;
  const paused = answer?.kind === "paused";
  return (
    <>
      <IconButton ref={anchor} size="sm" label={t("ai.related.menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="related-menu">
        <MoreHorizontal size={ICON.meta} />
      </IconButton>
      <MenuSurface open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="right" ariaLabel={t("ai.related.menu")}>
        {paused ? (
          <MenuItem icon={<Play size={ICON.ui} />} onSelect={() => void controller.resumeRelated(path)}>
            {t("ai.related.resumeNote")}
          </MenuItem>
        ) : (
          <MenuItem icon={<Pause size={ICON.ui} />} onSelect={() => void controller.pauseRelated(path)} data-testid="related-pause-note">
            {t("ai.related.pauseNote")}
          </MenuItem>
        )}
        <MenuItem icon={<Pause size={ICON.ui} />} onSelect={() => void controller.setRelatedVaultPaused(true)} data-testid="related-pause-vault">
          {t("ai.related.pauseVault")}
        </MenuItem>
      </MenuSurface>
    </>
  );
}

/** The same pause on the phone: plain buttons under the tab's list. */
export function RelatedNotesActions({ path, answer }: { path: string; answer: RelatedAnswer | null }) {
  const { t } = useTranslation();
  const { controller } = useLocalEmbeddings();
  const [busy, setBusy] = useState(false);
  if (!controller || !answer || answer.kind === "off") return null;
  const run = (work: Promise<void>) => {
    setBusy(true);
    void work.finally(() => setBusy(false));
  };
  return (
    <div className="pv-related-pause">
      {answer.kind === "vaultPaused" ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(controller.setRelatedVaultPaused(false))} data-testid="related-resume-vault">
          {t("ai.related.resumeVault")}
        </Button>
      ) : (
        <>
          {answer.kind !== "paused" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(controller.pauseRelated(path))} data-testid="related-pause-note">
              {t("ai.related.pauseNote")}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(controller.setRelatedVaultPaused(true))} data-testid="related-pause-vault">
            {t("ai.related.pauseVault")}
          </Button>
        </>
      )}
    </div>
  );
}
