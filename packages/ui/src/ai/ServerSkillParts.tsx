import { useCallback, useState } from "react";
import { compareLines, type CompareLine } from "../lib/compareVersions";
import type { AiSession, ServerSkillText } from "./aiSession";

/**
 * Parts of the review of a skill a connected server serves (plan KI-Harness
 * P9-4b), for both shells' dialogs: its instructions — and every file a model
 * may read of it — are read only when the user asks for them (the extension
 * says nothing is read ahead, not even to approve), checked like a load
 * before anything of them is shown, and shown only for exactly the version
 * the review shows: a reading belongs to the files and the description it was
 * made for, and goes when the review shows another — saying that the skill
 * changed, never silently.
 */

type Reading = { key: string; phase: "reading" } | { key: string; phase: "done"; result: ServerSkillText };

export interface ServerSkillTextView {
  /** The instructions are being read. */
  reading: boolean;
  /**
   * What reading them brought — for the version the review shows now; null
   * before the user asked. A reading of another version of the same skill —
   * finished or under way — is `changed`: the user read, or asked for,
   * something else than the review shows now.
   */
  result: ServerSkillText | null;
  /** Reads them now — again, where they were read before. */
  read: () => void;
}

/**
 * `seen`: what the review shows of the skill (`approvalFacts(...).seen`),
 * every file by its digest and the listed frontmatter. A reading is kept
 * under it, and read only while the skill is still that one.
 */
export function useServerSkillText(session: Pick<AiSession, "serverSkillText"> | null, id: string | null, seen: Readonly<Record<string, string>> | null): ServerSkillTextView {
  const [state, setState] = useState<Reading | null>(null);
  const key = id && seen ? `${id}\n${JSON.stringify(Object.entries(seen).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))}` : null;
  const read = useCallback(() => {
    if (!session || !id || !seen || !key) return;
    setState({ key, phase: "reading" });
    // An answer for another skill — or another version of this one — than the one shown now is dropped.
    const settle = (result: ServerSkillText) => setState((now) => (now?.key === key ? { key, phase: "done", result } : now));
    void session.serverSkillText(id, seen).then(settle, () => settle({ ok: false, reason: "unavailable" }));
  }, [session, id, seen, key]);
  const current = state && state.key === key ? state : null;
  const another = Boolean(state && id && key && state.key !== key && state.key.startsWith(`${id}\n`));
  return { reading: current?.phase === "reading", result: current?.phase === "done" ? current.result : another ? { ok: false, reason: "changed" } : null, read };
}

/**
 * The instructions as the review shows them: held against the ones the user
 * read when they approved the skill, where they were kept — a changed skill
 * is never approved as "a few lines" nobody compared —, otherwise whole.
 */
export function serverSkillLines(approvedText: string | undefined, text: string): CompareLine[] | null {
  return approvedText !== undefined && approvedText !== text ? compareLines(approvedText, text) : null;
}
