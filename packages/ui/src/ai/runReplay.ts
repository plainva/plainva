import type { ConversationRecord, RunMeta, SnapshotState } from "@plainva/core";

/**
 * A run's snapshot and its replay (plan KI-Harness P9-2, ADR 0034): what a
 * view and the session ask of a stored run, as rules without IO.
 */

/**
 * Why a run cannot be asked again of another model. `later`: it is not the
 * first question of its conversation — it rests on what was said before,
 * and that history carries text that was put together for the original's
 * reader. `material`: it brought more than the user's words and notes — a
 * selection, a picture, a recording, a comment thread, a database's columns,
 * a folder log's changes —, which a replay does not bring again. `empty`:
 * there are no words to ask.
 */
export type ReplayRefusal = "later" | "material" | "empty";

/** The words a replay asks, or why there is none. */
export type ReplayRequest = { ok: true; words: string } | { ok: false; reason: ReplayRefusal };

/** A turn in which the user asked something — not one that carries the results of tools, which a conversation keeps under the same role. */
const isQuestion = (turn: ConversationRecord["conversation"]["turns"][number]): boolean => turn.role === "user" && turn.parts.some((part) => part.type === "text");

/** What a run asked, if it can be asked again: the first question of its conversation, with nothing but its context beside the user's words. */
export function replayRequest(record: ConversationRecord, run: RunMeta): ReplayRequest {
  const turns = record.conversation.turns;
  const turn = turns[run.userTurn];
  if (!turn || !isQuestion(turn)) return { ok: false, reason: "empty" };
  if (turns.slice(0, run.userTurn).some(isQuestion)) return { ok: false, reason: "later" };
  let words: string | null = null;
  let context = 0;
  for (const part of turn.parts) {
    if (part.type !== "text") return { ok: false, reason: "material" };
    if (part.context) {
      context += 1;
      if (context > 1) return { ok: false, reason: "material" };
      continue;
    }
    if (words !== null) return { ok: false, reason: "material" };
    words = part.text;
  }
  const brought = (run.manifest?.sources ?? []).some(
    (source) => source.selection || source.audioBytes !== undefined || source.comments !== undefined || source.image || source.columns !== undefined,
  );
  if (brought) return { ok: false, reason: "material" };
  return words !== null && words.trim() ? { ok: true, words } : { ok: false, reason: "empty" };
}

/** The notes a replay pins: those the run's context read — its evidence and its cards —, each once; a handle of the map read nothing. */
export function replaySources(run: RunMeta): string[] {
  return [...new Set((run.manifest?.sources ?? []).filter((source) => source.tier !== "map" && source.hash).map((source) => source.path))];
}

/** How the sources and skills of a run read now, by path and by skill id (`RunMeta.skills`). */
export interface RunSnapshotStates {
  /** The notes the run's context carried, by path. */
  sources: Record<string, SnapshotState>;
  /** The notes its tools read whole, by path. */
  read: Record<string, SnapshotState>;
  /** Its skills, by id: their `SKILL.md` now against the version the run used. */
  skills: Record<string, SnapshotState>;
}

/** The tools a run called, by name, each with how often — read from the turns that answer its user turn, up to the next question. */
export function runToolCalls(record: ConversationRecord, run: RunMeta): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  const turns = record.conversation.turns;
  for (let i = run.userTurn + 1; i < turns.length; i++) {
    const turn = turns[i]!;
    if (isQuestion(turn)) break;
    for (const part of turn.parts) if (part.type === "tool_call") counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}
