import type { Conversation } from "../conversation.js";
import { checkWebUrl } from "./rules.js";

/**
 * Where a web address in a conversation came from (plan KI-Harness P4,
 * threat T2). A model that follows an instruction hidden in a note or a page
 * can put private text into an address it composes — `https://host/?d=…` —
 * and get it out with one request or one click. An address that stood in
 * the conversation before the model wrote it — in the user's words, in a
 * note, in a result — cannot carry anything the model added. So the app
 * tells the two apart and says so where a person decides: on the approval of
 * a fetch, and at a link in an answer.
 *
 * "The same address" is the whole address as a request would see it:
 * accepting its host alone would let a model hang data onto a host a note
 * merely mentions. What the model wrote itself earlier in the conversation
 * never counts as a source — not even when a tool hands it back.
 */

export type AddressOrigin =
  /** The user named it in this conversation. */
  | "user"
  /** A note or a result the conversation carries names it. */
  | "source"
  /** Nowhere before: the model put it together. */
  | "model";

export interface KnownAddresses {
  user: ReadonlySet<string>;
  source: ReadonlySet<string>;
}

// An address in running text: with a scheme, or the "www." form a renderer links on its own. It ends at
// whitespace, a quote or a square bracket — `[text](address)` is two addresses when the text is one too.
const ADDRESS = /\bhttps?:\/\/[^\s<>"'`\\[\]]+|(?<![\w.@/-])www\.[^\s<>"'`\\[\]]+/gi;
/** Sentence marks and Markdown that end up attached to an address in running text. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "*", "_", "~", "|"]);
const OPENERS: Readonly<Record<string, string>> = { ")": "(", "}": "{" };

const countOf = (text: string, char: string) => text.split(char).length - 1;

/** The address without what merely follows it in a sentence: marks, and a bracket that was opened before it. */
function withoutTrailing(address: string): string {
  let out = address;
  for (;;) {
    const last = out[out.length - 1];
    if (last === undefined) break;
    const opener = OPENERS[last];
    // "(see https://host/a)" ends before the bracket; "https://host/wiki/A_(b)" keeps its own.
    if (TRAILING.has(last) || (opener !== undefined && countOf(out, last) > countOf(out, opener))) out = out.slice(0, -1);
    else break;
  }
  return out;
}

/**
 * One address as it is compared: what a request to it would name, without
 * the fragment (it never leaves the device) and without the slash that ends
 * a path. A source that writes `http://` or `www.` names the https page all
 * the same — only https is ever requested. Null for what is no public web
 * address.
 */
export function comparableAddress(raw: string): string | null {
  const text = raw.trim().replace(/^http:\/\//i, "https://");
  const checked = checkWebUrl(/^www\./i.test(text) ? `https://${text}` : text);
  if (!checked.ok) return null;
  const url = checked.target.url;
  return url.includes("?") || !url.endsWith("/") ? url : url.slice(0, -1);
}

/** The public web addresses a text names, each once, as they are compared. */
export function webAddressesIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ADDRESS)) {
    const address = comparableAddress(withoutTrailing(match[0]));
    if (address) found.add(address);
  }
  return [...found];
}

/** A data fence in a text part: what it holds is somebody else's text, whoever's turn carries it. */
const FENCED = "<untrusted_data ";

/** Every string inside a tool call's arguments, however deep: what the model wrote into the call. */
function stringsIn(value: unknown, out: string[] = [], depth = 0): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object" && depth < 8) for (const item of Object.values(value)) stringsIn(item, out, depth + 1);
  return out;
}

/**
 * The addresses a conversation carried into the model: the user's own words,
 * and everything else in the user-side turns — the notes of the context, what
 * a door brought, the results of tools.
 *
 * A source is only what the model did not write first. A tool can echo its
 * arguments — "No section "…" in this note", "Web search for: …" — and an
 * address the model put into a call would come back looking like a result.
 * So the turns are read in order: what the model wrote, in an answer or in
 * the arguments of a call, never becomes a source afterwards, and a result
 * that reports an error — where echoes live — names no source at all. The
 * user's own words always count: typing an address is vouching for it.
 */
export function knownAddresses(conversation: Pick<Conversation, "turns">): KnownAddresses {
  const user = new Set<string>();
  const source = new Set<string>();
  const authored = new Set<string>();
  for (const turn of conversation.turns) {
    if (turn.role === "assistant") {
      for (const part of turn.parts) {
        // Its answer, the arguments of its calls, and its reasoning where a provider hands that back as text.
        const written = part.type === "text" ? [part.text] : part.type === "tool_call" ? stringsIn(part.args) : part.type === "reasoning" ? stringsIn(part.data) : [];
        for (const text of written) for (const address of webAddressesIn(text)) authored.add(address);
      }
      continue;
    }
    for (const part of turn.parts) {
      if (part.type === "tool_result") {
        if (part.isError) continue;
        for (const address of webAddressesIn(part.content)) if (!authored.has(address)) source.add(address);
      } else if (part.type === "text") {
        const own = !part.context && !part.text.includes(FENCED);
        for (const address of webAddressesIn(part.text)) {
          if (own) user.add(address);
          else if (!authored.has(address)) source.add(address);
        }
      }
    }
  }
  return { user, source };
}

/** Where an address came from; one that is no public web address at all counts as the model's. */
export function addressOrigin(rawUrl: string, known: KnownAddresses): AddressOrigin {
  const address = comparableAddress(rawUrl);
  if (!address) return "model";
  if (known.user.has(address)) return "user";
  return known.source.has(address) ? "source" : "model";
}
