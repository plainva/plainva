import type { AcpPermissionOption, AcpToolKind } from "@plainva/core";
import type { AcpAuthProblem, AcpSessionEvent, AcpSessionProblem, AiAcpAgent } from "./acpSession";
import type { AcpSessionEntry } from "./acpStores";

/**
 * An external agent's session as a person reads it (plan KI-Harness P4.6):
 * the lines Plainva itself writes into the thread, and what it says where an
 * agent did not come up or did not get in. Everything here turns what was
 * decided elsewhere into the user's language. Nothing here decides — and the
 * agent's own words (a title, an option's name, an error text) are shown as
 * its words, never passed off as the app's.
 */

type T = (key: string, vars?: Record<string, unknown>) => string;

/** A note as a line names it: its name without the folders and without `.md`. */
export function agentNoteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "") || path;
}

/** One of Plainva's own lines in a session's thread. */
export function agentEventText(t: T, event: AcpSessionEvent, lintNote: string): string {
  switch (event.type) {
    case "proposed":
      return `${t("ai.agent.event.proposed", { note: agentNoteName(event.path), count: event.blocks })}${event.defused ? ` ${lintNote}` : ""}`;
    case "new":
      return t("ai.agent.event.new", { note: event.path });
    case "created":
      return t("ai.agent.event.created", { note: event.path });
    case "discarded":
      return t("ai.agent.event.discarded", { note: event.path });
    case "direct":
      return t("ai.agent.event.direct", { note: event.path });
    case "refused":
      return t(`ai.agent.event.refused.${event.what}`, { path: event.path, reason: t(`ai.agent.reason.${event.reason}`) });
    case "stopped":
      return t(`ai.agent.event.stopped.${event.reason}`);
    case "failed": {
      // The agent's own words for what went wrong: a string the session read from its answer — never an error object —, or none.
      const said = event.message;
      return said ? t("ai.agent.event.failedSaid", { message: said }) : t("ai.agent.event.failed");
    }
    case "note-kept":
      return t("ai.agent.event.noteKept", { note: agentNoteName(event.path) });
  }
}

/** How a line of Plainva's own looks: something that waits or was done, something the user should notice, something that did not happen. */
export function agentEventTone(event: AcpSessionEvent): "done" | "notice" | "failed" {
  if (event.type === "refused" || event.type === "failed") return "failed";
  if (event.type === "direct" || event.type === "note-kept" || (event.type === "stopped" && event.reason !== "cancelled")) return "notice";
  return "done";
}

/** Why a session ended that did not end by the user's hand. */
export function agentProblemText(t: T, problem: AcpSessionProblem): string {
  switch (problem.kind) {
    case "start":
      return t(`ai.agent.ended.start.${problem.word}`);
    case "exited":
      return problem.code === null || problem.code === 0 ? t("ai.agent.ended.exited") : t("ai.agent.ended.exitedCode", { code: problem.code });
    case "agent": {
      const said = problem.message;
      return said ? t("ai.agent.ended.agentSaid", { message: said }) : t("ai.agent.ended.protocol");
    }
    default:
      return t(`ai.agent.ended.${problem.kind}`);
  }
}

/** Why a sign-in did not happen. A terminal that could not be opened is said where the command to copy stands. */
export function agentAuthProblemText(t: T, problem: AcpAuthProblem): string | null {
  switch (problem) {
    case "no-terminal":
      return null;
    case "declined":
    case "failed":
    case "cancelled":
    case "no-method":
      return t(`ai.agent.auth.problem.${problem}`);
    default:
      return t("ai.agent.auth.problem.start");
  }
}

/** A kind of tool call in Plainva's words — what a line or a question says where the agent brought no words of its own. */
export function agentKindText(t: T, kind: AcpToolKind): string {
  return t(`ai.agent.kind.${kind}`);
}

/** An option of the agent's question: its own name, or Plainva's word for the kind where it brought none. */
export function agentOptionText(t: T, option: AcpPermissionOption): string {
  return option.name || t(`ai.agent.option.${option.kind}`);
}

/** The options in the order a person reads them: what says no first, what says yes last — as every question of the app has it. */
export function agentOptionsInOrder(options: readonly AcpPermissionOption[]): AcpPermissionOption[] {
  const rank = (option: AcpPermissionOption) => (option.kind === "reject_always" ? 0 : option.kind === "reject_once" ? 1 : option.kind === "allow_always" ? 2 : 3);
  return [...options].sort((a, b) => rank(a) - rank(b));
}

/** One session of the vault's log in a line. */
export function agentSessionLine(t: T, entry: AcpSessionEntry, language: string): string {
  const at = new Date(entry.at);
  const when = Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(at);
  return t("ai.agent.sessionLine", { when, agent: entry.label, turns: entry.turns, proposed: entry.proposed + entry.created, direct: entry.direct });
}

/** What Plainva saw of an agent's changes on this device, for its row in the settings. */
export function agentSeenText(t: T, agent: AiAcpAgent, language: string): string {
  if (!agent.seen) return t("ai.agent.settings.unseen");
  const at = new Date(agent.seen.at);
  const when = Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(at);
  return t("ai.agent.settings.seen", { when, proposed: agent.seen.proposed, direct: agent.seen.direct });
}

/** Arguments as a person types them into the add dialog: one per line, blank lines left out. */
export function agentArgsFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
