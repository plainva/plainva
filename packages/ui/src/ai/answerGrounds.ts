import type { AnswerGrounding, RunMeta } from "@plainva/core/ai";

/** How many notes the calm line under an answer names before it counts the rest (plan Oberfläche O7, M6). */
export const GROUNDS_NAMED = 2;

/**
 * The notes an answer rests on, by the names the reader knows them by (plan
 * Oberfläche O7, M6: "Grundlage: Website relaunch"): the notes that went with
 * it — a picture is none —, each once, in the order of the send overview; the
 * run's paths where it kept no overview.
 */
export function groundTitles(run: Pick<RunMeta, "sent" | "manifest">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sources = run.manifest ? run.manifest.sources.filter((s) => !s.image).map((s) => ({ path: s.path, title: s.title })) : run.sent.map((path) => ({ path, title: "" }));
  for (const { path, title } of sources) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(title || path.replace(/^.*\//, "").replace(/\.md$/i, ""));
  }
  return out;
}

/**
 * What the model had of the vault by the end of run `upTo` of a conversation
 * (plan Oberfläche O7, E2): the notes every run up to it sent or read — the
 * context of earlier turns goes on as text, and an unchanged note is not sent
 * again, so a follow-up that cites a note from the first turn cites a note
 * the model had. A run whose request reached no model still counts: its
 * message and its context stay in the conversation and go with the next
 * request (review O7, second round). One run that read more than it listed
 * makes the whole unknown.
 */
export function conversationGrounding(runs: readonly RunMeta[], upTo: number, from?: string): AnswerGrounding {
  const sent: string[] = [];
  const read: string[] = [];
  const titled: { path: string; title: string }[] = [];
  let readMore = false;
  for (const run of runs.slice(0, upTo + 1)) {
    sent.push(...run.sent);
    read.push(...(run.read ?? []));
    readMore ||= Boolean(run.readMore);
    for (const source of run.manifest?.sources ?? []) if (!source.image && source.title) titled.push({ path: source.path, title: source.title });
  }
  return { sent, read, readMore, titled, ...(from ? { from } : {}) };
}
