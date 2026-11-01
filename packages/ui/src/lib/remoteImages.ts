import { parseMarkdownTree, type MarkdownTreeNode } from "@plainva/core";
import { findMediaEmbeds } from "./imageTarget";

/**
 * A picture from the web, written into a note by someone else, made a link —
 * the ONE rule for text Plainva writes into a note from a message: the filed
 * mail and the reply note (open-items plan 3.79, decision E1 of the
 * bug-clearing plan).
 *
 * The editor and the reading view load a picture a note embeds from the web:
 * that is what `![x](https://…)` is for in a note a person writes (checked in
 * a real browser, `apps/desktop/e2e/parse-budget.spec.ts`). The text of a
 * message is the sender's. Written into a note unchanged, a picture in it is
 * fetched each time the note is opened — and the sender learns when, the very
 * thing the mail reader blocks pictures for. So every picture with an address
 * on the web becomes a link to the same address: `[x](https://…)`, and one
 * without words `[https://…](https://…)`. It reads as before and is one click away;
 * nothing is fetched by opening the note. Everything else in the text — lists,
 * quotes, links, a picture from the vault — stays as the sender wrote it.
 *
 * A picture is found the way EACH of the two loads it: the editor's finder
 * (`findMediaEmbeds`: `![x](…)` and `![[…]]`) and the reading view's parser
 * (`![x](…)`, `![x][label]` with its definition). Removing a `!` can make
 * another picture of the one behind it (`!![x](…)`), so the text is read
 * again until nothing is left to change.
 */
export function defuseRemoteImages(markdown: string): string {
  let text = markdown;
  // Each round removes at least one `!`, so this ends; the bound is for a text no person writes.
  for (let round = 0; round < 64; round++) {
    const edits = remoteImageEdits(text);
    if (edits.length === 0) return text;
    text = applyEdits(text, edits);
  }
  // Still more: every `![` is written so that no reader takes it for a picture.
  return text.split("![").join("!\\[");
}

/** An address a picture would be fetched from: any scheme but `data:`, or one that starts with `//`. */
export function isRemoteImageAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.startsWith("//")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  return scheme !== null && scheme[1].toLowerCase() !== "data";
}

interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * A link that reads as its address, `[address](address)`, for a picture
 * without words; nothing where the address holds a blank or an angle bracket.
 * Its words are escaped so that nothing in the address reads as Markdown; a
 * destination with a parenthesis goes in angle brackets.
 */
function linkTo(address: string): string | null {
  if (/[\s<>]/.test(address)) return null;
  const words = address.replace(/[\\[\]*_`~]/g, (ch) => `\\${ch}`);
  return `[${words}](${/[()]/.test(address) ? `<${address}>` : address})`;
}

interface PictureNode extends MarkdownTreeNode {
  alt?: string | null;
  identifier?: string;
}

function remoteImageEdits(text: string): Edit[] {
  const edits: Edit[] = [];
  const removeBang = (at: number) => {
    if (text[at] === "!") edits.push({ from: at, to: at + 1, insert: "" });
  };
  const tree = parseMarkdownTree(text) as PictureNode;
  // The editor's finder. It draws nothing in code, nor behind a backslash.
  const code: Array<[number, number]> = [];
  const visit: PictureNode[] = [tree];
  for (let node = visit.pop(); node; node = visit.pop()) {
    if ((node.type === "code" || node.type === "inlineCode") && node.position) code.push([node.position.start.offset, node.position.end.offset]);
    for (const child of node.children ?? []) visit.push(child as PictureNode);
  }
  const literal = (at: number) => {
    let slashes = 0;
    while (text[at - 1 - slashes] === "\\") slashes++;
    return slashes % 2 === 1 || code.some(([from, to]) => at >= from && at < to);
  };
  for (const embed of findMediaEmbeds(text)) {
    if (!isRemoteImageAddress(embed.target) || literal(embed.start)) continue;
    const link = embed.syntax === "wiki" ? linkTo(embed.target) : null;
    if (link) edits.push({ from: embed.start, to: embed.end, insert: link });
    else removeBang(embed.start);
  }
  // The reading view's parser, with the definitions a reference picture reads its address from.
  const definitions = new Map<string, string>();
  const pictures: Array<{ node: PictureNode; address: string | undefined }> = [];
  const open: PictureNode[] = [tree];
  for (let node = open.pop(); node; node = open.pop()) {
    if (node.type === "definition" && node.identifier !== undefined && node.url !== undefined && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
    if (node.type === "image") pictures.push({ node, address: node.url });
    if (node.type === "imageReference") pictures.push({ node, address: undefined });
    for (const child of node.children ?? []) open.push(child as PictureNode);
  }
  for (const { node, address: own } of pictures) {
    const address = own ?? (node.identifier !== undefined ? definitions.get(node.identifier) : undefined);
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (address === undefined || from === undefined || to === undefined || !isRemoteImageAddress(address)) continue;
    const link = node.alt ? null : linkTo(address);
    if (link) edits.push({ from, to, insert: link });
    else removeBang(from);
  }
  return edits;
}

/** Applies edits in text order; an edit that overlaps one before it waits for the next round. */
function applyEdits(text: string, edits: Edit[]): string {
  edits.sort((a, b) => a.from - b.from || b.to - a.to);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.from < at) continue;
    out += text.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  return out + text.slice(at);
}
