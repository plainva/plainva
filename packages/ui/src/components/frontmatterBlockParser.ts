import type { markdown } from "@codemirror/lang-markdown";
import { BYTE_ORDER_MARK, isFence } from "./editorFrontmatter";

/**
 * The properties block as a node of the editor's Markdown tree (Sammelplan
 * § 3.46).
 *
 * `@codemirror/lang-markdown` does not know a properties block. It read the
 * block's lines as Markdown, and the editor skipped afterwards what BEGAN in
 * front of the block's end. A YAML line that opens something Markdown only
 * ends with a close of its own — a code fence in a multi-line value, an
 * `<!--` — made a node that ran to the end of the note: the whole text was
 * code or a comment to the editor, without formatting, block handles, tag
 * pills or spell checking, while the reading view showed it right.
 *
 * Now the block is one node, `FrontMatter`, read by the editor's one rule
 * (`editorFrontmatter.ts`, held against the core's `frontmatterSpan`): it opens
 * on the first line, which is a fence (behind a byte order mark, if one is
 * there), and closes on the next fence; without a closing fence there is no
 * block. Nothing inside it is Markdown, so nothing that starts there reaches
 * past it.
 *
 * Only the note editor's language carries it. The composer of mails and
 * events edits a message, which has no properties block, so a message that
 * begins with a `---` line stays text.
 */
type MarkdownExtensions = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

/** What the parse reads from: the part of lezer's `Input` this needs. */
interface Input {
  readonly length: number;
  read(from: number, to: number): string;
}

/** How much of the input one look ahead reads: the block is found without reading the note. */
const CHUNK = 4096;

/** The number of lines behind the first one up to the closing fence, or 0 without one. */
function linesToClose(input: Input, firstLineEnd: number): number {
  let lineStart = firstLineEnd + 1;
  let count = 0;
  let buffer = "";
  let bufferStart = lineStart;
  while (lineStart <= input.length) {
    let lineEnd = buffer.indexOf("\n", lineStart - bufferStart);
    while (lineEnd < 0 && bufferStart + buffer.length < input.length) {
      buffer += input.read(bufferStart + buffer.length, Math.min(input.length, bufferStart + buffer.length + CHUNK));
      lineEnd = buffer.indexOf("\n", lineStart - bufferStart);
    }
    const end = lineEnd < 0 ? bufferStart + buffer.length : bufferStart + lineEnd;
    count++;
    if (isFence(buffer.slice(lineStart - bufferStart, end - bufferStart), 0)) return count;
    if (lineEnd < 0) return 0;
    lineStart = end + 1;
    // Keep the buffer to what is still ahead.
    buffer = buffer.slice(lineStart - bufferStart);
    bufferStart = lineStart;
  }
  return 0;
}

export const frontmatterBlock: MarkdownExtensions = {
  defineNodes: [{ name: "FrontMatter", block: true }],
  parseBlock: [
    {
      name: "FrontMatter",
      before: "IndentedCode",
      parse(cx, line) {
        // At the very start of the note, in no container (the document is one).
        if (cx.lineStart !== 0 || cx.depth > 1) return false;
        const text = line.text;
        if (!isFence(text, text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0)) return false;
        // The context keeps its input to itself; the look ahead needs it, or a
        // block without a closing fence would have eaten the lines it read.
        const input = (cx as unknown as { input: Input }).input;
        const lines = linesToClose(input, text.length);
        if (lines === 0) return false;
        for (let i = 0; i < lines; i++) cx.nextLine();
        const end = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt("FrontMatter", 0, end));
        return true;
      },
    },
  ],
};
