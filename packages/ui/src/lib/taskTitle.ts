import { parseInlineMarkdown, type InlineNode } from "./inlineMarkdown";

/**
 * How the title of a task reads (TestFlight wish of 2026-10-24, E3).
 *
 * A task line is Markdown, and a wiki link in it stood in every task list as
 * written — `[[Alexander Gaas|Alex]] fragen …`. Now a list shows the link as
 * its text: the alias where there is one, else the note's NAME (not its folder,
 * not the heading after `#`), in the wiki-link style, and a tap on it opens the
 * note (`TaskTitle`). Where a title is plain text — a sheet's heading, a menu
 * entry, a notice — it reads the same words without the brackets
 * (`taskPlainTitle`).
 */

type WikiLinkNode = Extract<InlineNode, { kind: "wikiLink" }>;

/** The words a wiki link shows in a task's title: its alias, else the name of the note it names. */
export function wikiLinkLabel(node: WikiLinkNode): string {
  // The anchor keeps its mark (`#Heading`, `^block`, `splitLinkAnchor`).
  const written = node.target + (node.anchor ?? "");
  // `display` is the alias, or the link as written when it has none.
  if (node.display !== written && node.display !== node.target) return node.display;
  // The name of the note: no folder, no heading or block after `#`.
  const [base, heading] = node.target.split("#");
  const name = base.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return name || heading || node.anchor?.replace(/^#?\^?/, "") || node.display;
}

function plain(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
      case "code":
        out += n.text;
        break;
      case "br":
        out += " ";
        break;
      case "checkbox":
        out += n.checked ? "☑" : "☐";
        break;
      case "wikiLink":
        out += wikiLinkLabel(n);
        break;
      case "link":
        out += n.label;
        break;
      case "url":
        out += n.href;
        break;
      default:
        out += plain(n.children);
    }
  }
  return out;
}

/** A task's title as plain words — links as their text, emphasis without its marks. */
export function taskPlainTitle(title: string): string {
  return plain(parseInlineMarkdown(title)).replace(/\s{2,}/g, " ").trim() || title;
}
