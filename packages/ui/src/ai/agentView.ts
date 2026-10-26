import type { AcpCommand, AcpConfigOption, AcpConfigValue, AcpPermissionOption, AcpToolKind } from "@plainva/core";
import type { AcpAuthProblem, AcpSessionEvent, AcpSessionProblem, AcpThreadItem, AiAcpAgent } from "./acpSession";
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

/**
 * A part of one of Plainva's sentences (plan P9-7): its own words; a
 * stranger's — an agent's —, kept apart (`said`); or a name of the vault's
 * or the user's — a note —, isolated in its direction but no stranger's
 * (`name`).
 */
export type SentencePart = string | { said: string } | { name: string };

/** Marks for a sentence's values while it is put together: private-use characters, which no text of the app holds. */
const VALUE_MARKS = Array.from({ length: 8 }, (_, index) => String.fromCharCode(0xe000 + index));

/**
 * One of Plainva's sentences with values in it (plan P9-7): no value passes through the sentence's interpolation —
 * a name with "{{agent}}" in it stays a name, and no value lands in another's place. A stranger's words —
 * `{ said }`, an agent's — come back as parts of their own, to be drawn apart from Plainva's words and isolated in
 * their direction; Plainva's own and the user's words, and numbers, become the sentence's text.
 */
export function sentence(t: T, key: string, values: Record<string, SentencePart | number>): SentencePart[] {
  const names = Object.keys(values).filter((name) => typeof values[name] !== "number");
  if (names.length > VALUE_MARKS.length) throw new Error("too many values for one sentence");
  const marked = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === "number" ? value : VALUE_MARKS[names.indexOf(name)]]));
  const parts: SentencePart[] = [];
  let run = "";
  for (const char of t(key, marked)) {
    const index = VALUE_MARKS.indexOf(char);
    const value = index >= 0 && index < names.length ? values[names[index]!] : undefined;
    if (value === undefined) run += char;
    else if (typeof value !== "object") run += String(value);
    else {
      if (run) parts.push(run);
      run = "";
      parts.push("said" in value ? { said: value.said } : { name: value.name });
    }
  }
  if (run) parts.push(run);
  return parts;
}

/** A sentence of Plainva's as text, put together as `sentence` does it: for a tip, a name, a placeholder, a line of a list. */
export function sentenceString(t: T, key: string, values: Record<string, string | number>): string {
  return sentenceText(sentence(t, key, values));
}

/** The same with a stranger's words and the own ones given apart, as most lines have them: `said` the agent's, `own` Plainva's or the user's. */
export function saidSentence(t: T, key: string, said: Record<string, string>, own: Record<string, string | number> = {}): SentencePart[] {
  return sentence(t, key, { ...own, ...Object.fromEntries(Object.entries(said).map(([name, words]) => [name, { said: words }])) });
}

/** A setting as a line names it: the agent's own name for it, or — for its mode in the older form — Plainva's word. */
function settingName(t: T, setting: string | null): SentencePart {
  return setting === null ? t("ai.agent.config.mode") : { said: setting };
}

/** A sentence as plain text — for an accessible name, a test. */
export function sentenceText(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : "said" in part ? part.said : part.name)).join("");
}

/**
 * One of Plainva's own lines in a session's thread, in parts: what the agent named or said — a note's name, a path,
 * a setting and its value, its words for why — is a part of its own (plan P9-7).
 */
export function agentEventParts(t: T, event: AcpSessionEvent, lintNote: string): SentencePart[] {
  switch (event.type) {
    case "proposed": {
      const parts = saidSentence(t, "ai.agent.event.proposed", { note: agentNoteName(event.path) }, { count: event.blocks });
      return event.defused ? [...parts, ` ${lintNote}`] : parts;
    }
    case "new":
      return saidSentence(t, "ai.agent.event.new", { note: event.path });
    case "created":
      return saidSentence(t, "ai.agent.event.created", { note: event.path });
    case "discarded":
      return saidSentence(t, "ai.agent.event.discarded", { note: event.path });
    case "direct":
      return saidSentence(t, "ai.agent.event.direct", { note: event.path });
    case "refused":
      return saidSentence(t, event.what === "read" ? "ai.agent.event.refused.read" : "ai.agent.event.refused.write", { path: event.path }, { reason: t(`ai.agent.reason.${event.reason}`) });
    case "stopped":
      return [t(`ai.agent.event.stopped.${event.reason}`)];
    case "failed": {
      // The agent's own words for what went wrong: a string the session read from its answer — never an error object —, or none.
      const said = event.message;
      return said ? saidSentence(t, "ai.agent.event.failedSaid", { message: said }) : [t("ai.agent.event.failed")];
    }
    case "note-kept":
      // The user's own note, by its name — isolated in its direction: a file's name is whatever the vault holds.
      return sentence(t, "ai.agent.event.noteKept", { note: { name: agentNoteName(event.path) } });
    case "setting": {
      // The agent's own names for the setting and its value (plan P9-7) — its mode in the older form in Plainva's
      // word —; a switch says on or off. What came with the agent's answer to the user's own change is named as going
      // with it, not as the agent's own doing.
      const setting = settingName(t, event.setting);
      if (event.value === true) return sentence(t, event.along ? "ai.agent.event.settingOnAlong" : "ai.agent.event.settingOn", { setting });
      if (event.value === false) return sentence(t, event.along ? "ai.agent.event.settingOffAlong" : "ai.agent.event.settingOff", { setting });
      return sentence(t, event.along ? "ai.agent.event.settingAlong" : "ai.agent.event.setting", { setting, value: { said: event.value } });
    }
    case "setting-refused": {
      const setting = settingName(t, event.setting);
      if (event.reason === "sign-in") return sentence(t, "ai.agent.event.settingRefusedSignIn", { setting });
      const said = event.message;
      return said ? sentence(t, "ai.agent.event.settingRefusedSaid", { setting, message: { said } }) : sentence(t, "ai.agent.event.settingRefused", { setting });
    }
  }
}

/**
 * A step of the agent's in the thread (plan P4.6, P9-7): its own words for it — or Plainva's word for its kind —,
 * the vault's notes it named, and how many files it named outside the vault, in Plainva's words. The agent's words
 * and names are parts of their own: none of them can turn Plainva's count around or stand in its place.
 */
export function agentToolParts(t: T, line: Pick<Extract<AcpThreadItem, { kind: "tool" }>, "title" | "toolKind" | "files" | "outside">): SentencePart[] {
  const parts: SentencePart[] = [line.title ? { said: line.title } : agentKindText(t, line.toolKind)];
  // An agent's own words for a step usually name its file already: a name is not said twice.
  const files = line.files
    .slice(0, 3)
    .map(agentNoteName)
    .filter((name) => !line.title.includes(name));
  files.forEach((name, index) => parts.push(index === 0 ? " · " : ", ", { said: name }));
  if (line.outside > 0) parts.push(` · ${t("ai.agent.toolOutside", { count: line.outside })}`);
  return parts;
}

/**
 * What a menu of the agent's values is placed by (plan P9-7): each value with its group, name and description — a
 * change of any of them may change the menu's size. Said as a list, so that no value's words look like two values.
 */
export function agentValuesKey(values: readonly AcpConfigValue[]): string {
  return JSON.stringify(values.map((value) => [value.group ?? null, value.value, value.name, value.description]));
}

/** The same for the menu of the agent's other settings. */
export function agentOptionsKey(options: readonly AcpConfigOption[]): string {
  return JSON.stringify(options.map((option) => (option.type === "select" ? [option.id, option.name, agentValuesKey(option.values)] : [option.id, option.name, option.description])));
}

/** The same for one setting's menu: its heading — the setting's name, which the agent may change while it is open — and its values. */
export function agentMenuKey(heading: readonly SentencePart[], values: readonly AcpConfigValue[]): string {
  return JSON.stringify([sentenceText(heading), agentValuesKey(values)]);
}

/** The same for the list of the agent's commands: the ones it shows, with their words, and how many more there are. */
export function agentCommandsKey(shown: readonly AcpCommand[], more: number): string {
  return JSON.stringify([shown.map((command) => [command.name, command.description, command.hint]), more]);
}

/**
 * A message as it goes to the agent (plan P9-7): where it begins with one of
 * the agent's commands in another spelling of its name — composed where the
 * agent wrote it decomposed —, with the name as the agent spells it: that is
 * the name it recognises.
 */
export function agentSpelledMessage(text: string, commands: readonly AcpCommand[]): string {
  // Read as it goes: without the blanks around it.
  const message = text.trim();
  const typed = /^\/(\S+)/.exec(message);
  if (!typed) return text;
  const command = commands.find((entry) => entry.name !== typed[1] && entry.name.normalize("NFC") === typed[1]!.normalize("NFC"));
  return command ? `/${command.name}${message.slice(typed[0].length)}` : text;
}

/** One of Plainva's own lines in a session's thread, as text. */
export function agentEventText(t: T, event: AcpSessionEvent, lintNote: string): string {
  return sentenceText(agentEventParts(t, event, lintNote));
}

/** How a line of Plainva's own looks: something that waits or was done, something the user should notice, something that did not happen. */
export function agentEventTone(event: AcpSessionEvent): "done" | "notice" | "failed" {
  if (event.type === "refused" || event.type === "failed" || event.type === "setting-refused") return "failed";
  // A setting the agent changed by itself is worth noticing: a mode may waive a question of the agent's own.
  if (event.type === "direct" || event.type === "note-kept" || event.type === "setting" || (event.type === "stopped" && event.reason !== "cancelled")) return "notice";
  return "done";
}

/** Why a session ended that did not end by the user's hand, in parts: the agent's own words for it are its own (plan P9-7). */
export function agentProblemParts(t: T, problem: AcpSessionProblem): SentencePart[] {
  switch (problem.kind) {
    case "start":
      return [t(`ai.agent.ended.start.${problem.word}`)];
    case "exited":
      return [problem.code === null || problem.code === 0 ? t("ai.agent.ended.exited") : t("ai.agent.ended.exitedCode", { code: problem.code })];
    case "agent": {
      const said = problem.message;
      return said ? saidSentence(t, "ai.agent.ended.agentSaid", { message: said }) : [t("ai.agent.ended.protocol")];
    }
    default:
      return [t(`ai.agent.ended.${problem.kind}`)];
  }
}

/** The same as text. */
export function agentProblemText(t: T, problem: AcpSessionProblem): string {
  return sentenceText(agentProblemParts(t, problem));
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
  return sentenceString(t, "ai.agent.sessionLine", { when, agent: entry.label, turns: entry.turns, proposed: entry.proposed + entry.created, direct: entry.direct });
}

/** What Plainva saw of an agent's changes on this device, for its row in the settings. */
export function agentSeenText(t: T, agent: AiAcpAgent, language: string): string {
  if (!agent.seen) return t("ai.agent.settings.unseen");
  const at = new Date(agent.seen.at);
  const when = Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(at);
  return sentenceString(t, "ai.agent.settings.seen", { when, proposed: agent.seen.proposed, direct: agent.seen.direct });
}

/** Arguments as a person types them into the add dialog: one per line, blank lines left out. */
export function agentArgsFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
