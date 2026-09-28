import type { ConversationRecord, RunMeta } from "@plainva/core";

/**
 * What a reader sees of a conversation (P1a): the user's words, the answers,
 * the tool steps between them and one line per run saying what was sent where.
 * Derived on every render from the stored turns — the transcript is never a
 * second copy of the conversation.
 */
export type TranscriptItem =
  | { kind: "user"; key: string; text: string; context: string[] }
  | { kind: "answer"; key: string; text: string }
  | { kind: "steps"; key: string; steps: { id: string; name: string; state: "done" | "failed" | "open" }[] }
  | { kind: "run"; key: string; run: RunMeta };

/** The path of a context stamp (`path#hash`). */
export function stampPath(stamp: string): string {
  const cut = stamp.lastIndexOf("#");
  return cut > 0 ? stamp.slice(0, cut) : stamp;
}

export function transcriptOf(record: ConversationRecord): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const turns = record.conversation.turns;
  const runs = [...record.runs].sort((a, b) => a.userTurn - b.userTurn);
  // A run's line goes after the last turn before the next run began.
  const runAfter = new Map<number, RunMeta>();
  runs.forEach((run, i) => {
    const end = (runs[i + 1]?.userTurn ?? turns.length) - 1;
    runAfter.set(end, run);
  });
  let steps: Extract<TranscriptItem, { kind: "steps" }> | null = null;
  const stepIndex = new Map<string, { state: "done" | "failed" | "open" }>();
  turns.forEach((turn, index) => {
    if (turn.role === "user") {
      const texts = turn.parts.filter((p) => p.type === "text");
      const results = turn.parts.filter((p) => p.type === "tool_result");
      for (const result of results) {
        const step = stepIndex.get(result.callId);
        if (step) step.state = result.isError ? "failed" : "done";
      }
      const context = texts.flatMap((p) => (p.context ? p.context.map(stampPath) : []));
      const words = texts.filter((p) => !p.context).map((p) => p.text).join("\n\n");
      if (words || context.length) {
        steps = null;
        items.push({ kind: "user", key: `u${index}`, text: words, context });
      }
    } else {
      const text = turn.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
      if (text.trim()) {
        steps = null;
        items.push({ kind: "answer", key: `a${index}`, text });
      }
      for (const part of turn.parts) {
        if (part.type !== "tool_call") continue;
        if (!steps) {
          steps = { kind: "steps", key: `s${index}`, steps: [] };
          items.push(steps);
        }
        const step = { id: part.id, name: part.name, state: "open" as "done" | "failed" | "open" };
        steps.steps.push(step);
        stepIndex.set(part.id, step);
      }
    }
    const run = runAfter.get(index);
    if (run) {
      steps = null;
      items.push({ kind: "run", key: `r${index}`, run });
    }
  });
  return items;
}
