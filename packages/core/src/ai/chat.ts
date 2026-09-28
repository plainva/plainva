import type { Conversation, TextPart } from "./conversation.js";
import { gateDecision, isCloudRecipient, redactDeniedLinks, type EgressRecipient, type GateDecision } from "./egressGate.js";
import type { EffectivePolicy } from "./policy.js";
import { fenceUntrusted, payload, UNTRUSTED_DATA_RULE } from "./trust.js";

/**
 * The chat of the first package (plan §21, P1a): the system prompt, and the
 * minimal context — the note the user has open and the notes they pinned —
 * put through the hard gate before anything is assembled (ADR 0017).
 */

export interface SystemPromptInput {
  /** The app language as an English name ("German"): the default answer language. */
  language: string;
  /** The day the conversation starts, as an ISO date. */
  today: string;
  /** Names of the tools the conversation carries (fixed for its lifetime). */
  tools: readonly string[];
}

const TOOL_LINES: Record<string, string> = {
  search_vault: "search_vault finds notes",
  read_note: "read_note reads a note or one of its sections",
  get_outline: "get_outline lists a note's sections and properties",
  get_tasks: "get_tasks lists tasks",
  query_base: "query_base reads a database",
  run_command: "run_command opens notes and views in the app (an unknown id returns the list of commands)",
};

/**
 * The system prompt is fixed for the whole conversation (append-only): no
 * note text, nothing that changes from one turn to the next.
 */
export function assistantSystemPrompt(input: SystemPromptInput): string {
  const lines = [
    "You are the assistant inside Plainva, an app for notes kept as Markdown files. The user's collection of notes is called the vault.",
    `Today is ${input.today}. Answer in ${input.language} unless the user writes in another language; then answer in theirs.`,
    UNTRUSTED_DATA_RULE,
    "When a statement rests on a note, name the note as a wikilink, for example [[Offer 2026]], so the user can open it. Do not invent notes, quotes or facts; say so when the vault does not answer the question.",
    "You cannot change notes, send anything or act outside this conversation. If the user asks for a change, show the proposed text in your answer.",
    "Do not include images, and do not link to web addresses the user did not give you.",
  ];
  const tools = input.tools.map((name) => TOOL_LINES[name]).filter(Boolean);
  if (tools.length) lines.push(`Look things up with the tools before you answer questions about the vault: ${tools.join("; ")}.`);
  return lines.join("\n\n");
}

/** A note offered as context: the open one, or one the user pinned. */
export interface ContextNote {
  path: string;
  title: string;
  text: string;
  pinned: boolean;
}

export interface ContextRef {
  path: string;
  title: string;
  pinned: boolean;
  /** False when the policy keeps the note away from this recipient. */
  sent: boolean;
  reason?: GateDecision["reason"];
}

export interface ContextPolicyHost {
  policyOf(path: string, text?: string): Promise<EffectivePolicy>;
  /** Resolves a link target as written to a vault path; null when it names no note. */
  resolveLink(target: string, fromPath: string): Promise<string | null>;
}

export interface AssembledContext {
  /** The part that goes before the user's words; null when nothing may be sent. */
  part: TextPart | null;
  refs: ContextRef[];
  /** Links to notes the policy denies, replaced in the text that was sent. */
  withheldLinks: number;
}

/** Characters of one note at most; the rest is left to read_note. */
export const CONTEXT_NOTE_LIMIT = 24_000;

/** FNV-1a, 32 bit: tells "same text as last time" apart, not a security boundary. */
export function contextStamp(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Withholds links to notes the recipient may not see. A denied note's title
 * would otherwise travel inside an allowed neighbour's text.
 */
export async function withholdDeniedLinks(
  text: string,
  fromPath: string,
  resolveLink: ContextPolicyHost["resolveLink"],
  isAllowed: (path: string) => Promise<boolean>,
): Promise<{ text: string; redacted: number }> {
  // First pass: collect every target exactly as the redactor parses it (wiki
  // and Markdown links alike), so what is resolved and what is replaced can
  // never disagree about where a link starts or ends.
  const targets = new Set<string>();
  redactDeniedLinks(text, (target) => {
    targets.add(target.trim());
    return false;
  });
  const denied = new Map<string, boolean>();
  for (const target of targets) {
    const path = await resolveLink(target, fromPath);
    denied.set(target, path ? !(await isAllowed(path)) : false);
  }
  return redactDeniedLinks(text, (target) => denied.get(target.trim()) ?? false);
}

/**
 * Assembles the context of one message through the hard gate: a denied note
 * contributes nothing — neither text nor title — and links to denied notes
 * inside allowed ones are withheld.
 */
export async function assembleContext(notes: readonly ContextNote[], recipient: EgressRecipient, host: ContextPolicyHost): Promise<AssembledContext> {
  const refs: ContextRef[] = [];
  const blocks: string[] = [];
  const stamps: string[] = [];
  let withheldLinks = 0;
  const decisions = new Map<string, GateDecision>();
  const decide = async (path: string, text?: string) => {
    let decision = decisions.get(path);
    if (!decision) {
      decision = gateDecision(await host.policyOf(path, text), { recipient, webTools: false });
      decisions.set(path, decision);
    }
    return decision;
  };
  for (const note of notes) {
    const decision = await decide(note.path, note.text);
    if (!decision.allowed) {
      refs.push({ path: note.path, title: note.title, pinned: note.pinned, sent: false, reason: decision.reason });
      continue;
    }
    let text = note.text;
    if (isCloudRecipient(recipient)) {
      const redacted = await withholdDeniedLinks(text, note.path, host.resolveLink, async (path) => (await decide(path)).allowed);
      text = redacted.text;
      withheldLinks += redacted.redacted;
    }
    if (text.length > CONTEXT_NOTE_LIMIT) text = `${text.slice(0, CONTEXT_NOTE_LIMIT)}\n\n[…the note continues; read_note gives the rest]`;
    blocks.push(fenceUntrusted(payload(text, { kind: "vault", path: note.path })));
    stamps.push(`${note.path}#${contextStamp(text)}`);
    refs.push({ path: note.path, title: note.title, pinned: note.pinned, sent: true });
  }
  if (!blocks.length) return { part: null, refs, withheldLinks };
  const header = refs.some((r) => r.sent && !r.pinned)
    ? "The note the user has open, and any notes they pinned to this conversation:"
    : "Notes the user pinned to this conversation:";
  return { part: { type: "text", text: `${header}\n\n${blocks.join("\n\n")}`, context: stamps }, refs, withheldLinks };
}

/** The context stamps the conversation sent last; a message resends notes only when they changed. */
export function lastSentContext(conversation: Conversation): readonly string[] | null {
  for (let i = conversation.turns.length - 1; i >= 0; i--) {
    const turn = conversation.turns[i];
    if (turn.role !== "user") continue;
    for (const part of turn.parts) if (part.type === "text" && part.context) return part.context;
  }
  return null;
}

/** True when the context of this message differs from what the conversation already carries. */
export function contextChanged(conversation: Conversation, part: TextPart | null): boolean {
  if (!part?.context) return false;
  const last = lastSentContext(conversation);
  return !last || last.length !== part.context.length || last.some((stamp, i) => stamp !== part.context![i]);
}
