/**
 * The assistant as someone a comment can address (plan KI-Harness P3-6).
 *
 * Mentions are derived from the text against a list of names and never stored
 * (see `commentMentions.ts`). The assistant joins that list as a pseudo member
 * — so "@AI" is typed, completed, highlighted and found by the same code that
 * handles "@Anna", and nothing about the comment record changes.
 *
 * Two kinds of id live here, and they are different things:
 * - `plainva-ai` (and `plainva-ai:<alias>`): the MENTION target, what a
 *   comment field offers after an "@";
 * - `plainva-ai/<model>`: the AUTHOR a reply or a proposal of the assistant
 *   is written under (ADR 0023).
 *
 * This file imports nothing, on purpose: the comment card's head and body use
 * it, and those are loaded by tests that replace the package barrels with a
 * fixed list of modules.
 */

export const AI_MENTION_ID = "plainva-ai";

/**
 * The short word for the assistant in the app's ten languages. A comment
 * written on a German device says "@KI"; a reader with an English or a French
 * app must still see it as a mention, so every device knows all three.
 */
export const AI_MENTION_ALIASES: readonly string[] = ["AI", "KI", "IA"];

export function isAiMentionId(id: string): boolean {
  return id === AI_MENTION_ID || id.startsWith(`${AI_MENTION_ID}:`);
}

/** An author id the assistant writes under. */
export function isAiAuthorId(id: string): boolean {
  return id.startsWith(`${AI_MENTION_ID}/`);
}

/** id -> name for the assistant: this device's own word first, then the other spellings. */
export function aiMentionNames(label: string): Map<string, string> {
  const names = new Map<string, string>();
  const own = label.trim();
  if (own) names.set(AI_MENTION_ID, own);
  for (const alias of AI_MENTION_ALIASES) {
    if (alias.toLowerCase() !== own.toLowerCase()) names.set(`${AI_MENTION_ID}:${alias}`, alias);
  }
  return names;
}

/** What a comment card reads mentions against: the members, and the assistant in every spelling. */
export function namesWithAi(members: ReadonlyMap<string, string>, label: string): Map<string, string> {
  return new Map([...members, ...aiMentionNames(label)]);
}

/**
 * What a comment field offers after an "@": the members — without the bylines
 * the assistant left on earlier replies and proposals, which are authors, not
 * people to address — and the assistant itself where it can answer.
 */
export function composerNames(members: ReadonlyMap<string, string>, label: string, offered: boolean): Map<string, string> {
  const names = new Map([...members].filter(([id]) => !isAiAuthorId(id)));
  const own = label.trim();
  if (offered && own) names.set(AI_MENTION_ID, own);
  return names;
}
