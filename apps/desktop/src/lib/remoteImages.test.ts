import { describe, expect, it } from "vitest";
import { parseMarkdownTree, type MarkdownTreeNode } from "@plainva/core";
import { defuseRemoteImages, findMediaEmbeds, isRemoteImageAddress } from "@plainva/ui";
import { buildEmailNoteContent, buildReplyNoteContent, type MailMessage } from "@plainva/ui/mail";

/**
 * A picture from the web in a message's text, filed into a note (open-items
 * plan 3.79, decision E1). The editor and the reading view load a picture a
 * note embeds from the web (`apps/desktop/e2e/parse-budget.spec.ts`), so a
 * sender could see each opening of the filed note. The text Plainva writes
 * from a message makes such a picture a link; everything else stays.
 */

/** Every picture with an address on the web that the editor's finder or the reading view's parser would load. */
function remotePictures(text: string): string[] {
  const found = findMediaEmbeds(text).filter((embed) => isRemoteImageAddress(embed.target)).map((embed) => embed.target);
  const definitions = new Map<string, string>();
  const references: string[] = [];
  const walk = (node: MarkdownTreeNode & { identifier?: string }) => {
    if (node.type === "image" && node.url && isRemoteImageAddress(node.url)) found.push(node.url);
    if (node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier, node.url);
    if (node.type === "imageReference" && node.identifier) references.push(node.identifier);
    for (const child of node.children ?? []) walk(child);
  };
  walk(parseMarkdownTree(text));
  for (const id of references) {
    const url = definitions.get(id);
    if (url && isRemoteImageAddress(url)) found.push(url);
  }
  return found;
}

const CASES: Array<[string, string, string]> = [
  ["a picture with words", "Look: ![pixel](https://t.example/p.png) here", "Look: [pixel](https://t.example/p.png) here"],
  ["a picture without words", "![](https://t.example/p.png)", "[https://t.example/p.png](https://t.example/p.png)"],
  ["a picture with a title", '![a](https://t.example/p.png "T")', '[a](https://t.example/p.png "T")'],
  ["a picture in angle brackets", "![a](<https://t.example/a b.png>)", "[a](<https://t.example/a b.png>)"],
  ["an embed in the editor's form", "![[https://t.example/p.png]]", "[https://t.example/p.png](https://t.example/p.png)"],
  ["an embed with a width", "![[https://t.example/p.png|300]]", "[https://t.example/p.png](https://t.example/p.png)"],
  ["a picture by reference", "![x][r]\n\n[r]: https://t.example/p.png", "[x][r]\n\n[r]: https://t.example/p.png"],
  ["a picture by reference without words", "![][r]\n\n[r]: https://t.example/p.png", "[https://t.example/p.png](https://t.example/p.png)\n\n[r]: https://t.example/p.png"],
  ["a picture by protocol-relative address", "![x](//t.example/p.png)", "[x](//t.example/p.png)"],
  ["a picture in a quote and a list", "> - ![x](http://t.example/p.gif)", "> - [x](http://t.example/p.gif)"],
  ["a bang in front of a bang", "!![x](https://t.example/p.png)", "[x](https://t.example/p.png)"],
  ["a sound from the web", "![](https://t.example/s.mp3)", "[https://t.example/s.mp3](https://t.example/s.mp3)"],
  ["a picture without words whose address holds Markdown", "![](https://t.example/a_b*(1).png)", "[https://t.example/a\\_b\\*(1).png](<https://t.example/a_b*(1).png>)"],
];

const KEPT: Array<[string, string]> = [
  ["a picture from the vault", "![x](attachments/p.png) and ![[p.png]]"],
  ["a picture written as data", "![x](data:image/png;base64,AAAA)"],
  ["a picture in inline code", "`![x](https://t.example/p.png)`"],
  ["a picture in fenced code", "```\n![x](https://t.example/p.png)\n```"],
  ["an escaped bang", "\\![x](https://t.example/p.png)"],
  ["a link", "[x](https://t.example/p.png) and <https://t.example>"],
  ["HTML, which no view of a note draws", '<img src="https://t.example/p.png">'],
  ["lists, quotes, headings, wiki links and tags", "# Hello\n\n- one\n- [[Note]]\n\n> quoted #tag"],
];

describe("defuseRemoteImages", () => {
  it.each(CASES)("makes %s a link", (_name, input, expected) => {
    expect(remotePictures(input).length).toBeGreaterThan(0);
    const out = defuseRemoteImages(input);
    expect(out).toBe(expected);
    expect(remotePictures(out)).toEqual([]);
  });

  it.each(KEPT)("leaves %s as it is", (_name, input) => {
    expect(defuseRemoteImages(input)).toBe(input);
  });

  it("leaves no picture from the web in a text made to hide one", () => {
    const tricky = [
      "!!![a](https://t.example/1.png)",
      "![![a](https://t.example/2.png)](https://t.example/3.png)",
      "![a](https://t.example/4.png)![b](https://t.example/5.png)",
      "![[https://t.example/6.png]]![[https://t.example/7.png]]",
      "*![a](https://t.example/8.png)*",
      "| ![a](https://t.example/9.png) |\n|---|\n| ![b](https://t.example/10.png) |",
    ].join("\n\n");
    expect(remotePictures(defuseRemoteImages(tricky))).toEqual([]);
  });
});

const MESSAGE: MailMessage = {
  id: "7",
  uidValidity: 1,
  providerMessageId: "<m@example.org>",
  subject: "Newsletter",
  from: "Sender <s@example.org>",
  to: "me@example.org",
  dateTs: Date.UTC(2026, 9, 1, 12),
  text: "Hello,\n\n![](https://tracker.example.org/open.png?id=42)\n\n- one\n- ![logo](https://tracker.example.org/logo.png)\n",
  html: null,
  attachments: [],
};

describe("the notes Plainva writes from a message", () => {
  it("files a mail with its pictures from the web as links", () => {
    const note = buildEmailNoteContent(MESSAGE, "acc", "INBOX", "2026-10-01");
    expect(note).toContain("Hello,\n\n[https://tracker.example.org/open.png?id=42](https://tracker.example.org/open.png?id=42)\n\n- one\n- [logo](https://tracker.example.org/logo.png)\n");
    expect(remotePictures(note)).toEqual([]);
  });

  it("quotes them as links in a reply note", () => {
    const note = buildReplyNoteContent(MESSAGE, "2026-10-01");
    expect(note).toContain("> [https://tracker.example.org/open.png?id=42](https://tracker.example.org/open.png?id=42)");
    expect(note).toContain("> - [logo](https://tracker.example.org/logo.png)");
    expect(remotePictures(note)).toEqual([]);
  });
});
