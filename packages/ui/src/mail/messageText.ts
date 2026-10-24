import { htmlToVisibleText, type MarkupNode } from "@plainva/core";
import { sanitizeEmailHtml } from "./mailSanitize";
import type { MailMessage } from "./types";

/** The two parts of a message its text can come from. */
export type MailBodyParts = Pick<MailMessage, "text" | "html">;

/** The attributes `htmlToVisibleText` reads off an element. */
const READ_ATTRIBUTES = ["style", "hidden", "open", "start"];

/** A node of the copied tree — plain data, in the shape `htmlToVisibleText` walks. */
interface CopiedNode {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes: CopiedNode[];
}

/**
 * How the platform's tree is read: each of the few things asked of a node is
 * asked through the prototype, never as a property of the node.
 *
 * A node of a parsed document answers to names the MARKUP chose (finding
 * 2026-10-12). `<form><input name="childNodes">` makes `form.childNodes` that
 * input, `name="nodeName"` and `name="getAttribute"` do the same for those, and
 * `<img name="body">` is what `document.body` answers where the engine follows
 * the standard. A walk that read the nodes directly found no children in such
 * a form — or threw and left the work to the portable parser, whose time a
 * sender can drive up at will. The markup read here has been through the
 * sanitizer, which takes such names out; the accessors from the prototypes
 * are the second lock, and the way the sanitizer reads its own tree.
 */
interface TreeAccess {
  body(page: Document): Element | undefined;
  nodeType(node: Node): number;
  nodeName(node: Node): string;
  childNodes(node: Node): ArrayLike<Node>;
  text(node: Node): string;
  attribute(element: Node, name: string): string | null;
}

/** `undefined` until asked for; `null` where the platform has no DOM to read with. */
let access: TreeAccess | null | undefined;

function treeAccess(): TreeAccess | null {
  if (access !== undefined) return access;
  access = null;
  if (typeof DOMParser !== "function" || typeof Document !== "function" || typeof Node !== "function" || typeof Element !== "function" || typeof CharacterData !== "function") {
    return access;
  }
  const getter = (prototype: object, name: string): ((this: unknown) => unknown) | undefined => Object.getOwnPropertyDescriptor(prototype, name)?.get;
  const nodeType = getter(Node.prototype, "nodeType");
  const nodeName = getter(Node.prototype, "nodeName");
  const childNodes = getter(Node.prototype, "childNodes");
  const data = getter(CharacterData.prototype, "data");
  const byTagName = Document.prototype.getElementsByTagName;
  const getAttribute = Element.prototype.getAttribute;
  if (!nodeType || !nodeName || !childNodes || !data || typeof byTagName !== "function" || typeof getAttribute !== "function") return access;
  access = {
    body: (page) => byTagName.call(page, "body")[0],
    nodeType: (node) => Number(nodeType.call(node)),
    nodeName: (node) => String(nodeName.call(node)),
    childNodes: (node) => childNodes.call(node) as ArrayLike<Node>,
    text: (node) => String(data.call(node)),
    attribute: (element, name) => getAttribute.call(element as Element, name),
  };
  return access;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The HTML part as the platform's own parser reads it, copied into plain
 * objects. That parser is the one the reader's frame uses, and it stops
 * nesting at a depth a page can have. The parsed document is inert: nothing in
 * it runs, and nothing it names is fetched. `null` where there is no such
 * parser, or no body in what it made.
 */
function readerTree(html: string): MarkupNode | null {
  const read = treeAccess();
  if (!read) return null;
  const body = read.body(new DOMParser().parseFromString(html, "text/html"));
  if (!body) return null;
  const root: CopiedNode = { nodeName: "#root", childNodes: [] };
  // No recursion: the depth is the parser's to bound, not the call stack's.
  const open: Array<{ from: Node; into: CopiedNode }> = [{ from: body, into: root }];
  for (let next = open.pop(); next; next = open.pop()) {
    const children = read.childNodes(next.from);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const type = read.nodeType(child);
      if (type === TEXT_NODE) {
        next.into.childNodes.push({ nodeName: "#text", value: read.text(child), childNodes: [] });
      } else if (type === ELEMENT_NODE) {
        const attrs: Array<{ name: string; value: string }> = [];
        for (const name of READ_ATTRIBUTES) {
          const value = read.attribute(child, name);
          if (value !== null) attrs.push({ name, value });
        }
        const copy: CopiedNode = { nodeName: read.nodeName(child), attrs, childNodes: [] };
        next.into.childNodes.push(copy);
        open.push({ from: child, into: copy });
      }
    }
  }
  return root;
}

/**
 * The markup the reader's frame is given for this HTML part: what the mail
 * sanitizer leaves of it. The text is read from THAT, so that it cannot hold
 * what the reader does not show for a reason only the sanitizer knows — a form
 * whose controls rename its properties is taken out whole there, with what it
 * holds (finding 2026-10-12: read from the raw markup, the quote could carry
 * words of such a form that were never on screen). Where there is no DOM for
 * the sanitizer to work on, the markup stays as it came.
 */
function readerMarkup(html: string): string {
  try {
    return sanitizeEmailHtml(html).html;
  } catch {
    return html;
  }
}

function htmlPartText(html: string): string {
  const shown = readerMarkup(html);
  let tree: MarkupNode | null = null;
  try {
    tree = readerTree(shown);
  } catch {
    /* a platform that refuses the parse: the portable parser reads the same markup */
  }
  const copied = tree;
  return copied ? htmlToVisibleText(shown, () => copied) : htmlToVisibleText(shown);
}

/**
 * The text of a message — the ONE place that says what it is, for everything
 * that turns a message into words of the user's own: the quote of a reply, a
 * forward, the reply note and the filed note.
 *
 * It is the message's plain-text part where it has one. Many do not: Microsoft
 * Graph hands a body over as HTML unless it is asked otherwise, and a sender is
 * free to write HTML only. Then it is the text of the HTML part as the reader
 * shows it — read from the markup the reader's frame is given, and without
 * what the message hides from the reader there (a preview line, a tracking
 * text), so nobody quotes or files words they never saw.
 *
 * Four callers used to read `message.text` on their own, and a message without
 * that part came out as an empty quote, a forward of nothing but its header
 * block, and a filed note without a body (finding 2026-10-09). No transport
 * hands out a text it made from the HTML part itself: the text part is the
 * sender's, and where there is none, the text is made here, for every backend.
 *
 * Line ends are `\n` whichever part the text came from: `\r\n` is how a mail
 * travels, not part of what it says, and a note is written with `\n`.
 */
export function mailMessageText(message: MailBodyParts): string {
  const plain = message.text ?? "";
  const text = plain.trim() ? plain : message.html ? htmlPartText(message.html) : "";
  return text.replace(/\r\n?/g, "\n");
}
