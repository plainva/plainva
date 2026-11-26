import { useEffect, useState, useSyncExternalStore } from "react";
import type { AiSession, NoteHintsAnswer } from "../ai/aiSession";
import type { RelatedAnswer } from "../ai/relatedNotesModel";
import { useLocalEmbeddings } from "./localModels";

/*
 * What the right column and the note sheet count before they draw a list: the related notes and the calm hints of
 * the open note (plan KI-Harness P2b-4, P8-3). Both ask the AI's session or models, and answer nothing while there are
 * none — so they live with the AI's ports, and the lists themselves load with the harness (performance plan L5).
 */

/** Waits this long after the last change before asking: switching through notes asks for the last one only. */
const RELATED_SETTLE_MS = 150;

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
    }, RELATED_SETTLE_MS);
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

/** Waits this long after the last change of the text before asking: typing asks once it rests. */
const HINTS_SETTLE_MS = 150;
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
    }, HINTS_SETTLE_MS);
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

