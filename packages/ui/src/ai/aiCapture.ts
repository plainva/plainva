import { conversationTitleFrom, setFrontmatterPath, trimChars, upsertFrontmatterKeys, type AiPolicyDimension, type OkfSource } from "@plainva/core";
import { safeFileStem } from "../lib/fileStem";
import { buildNewNoteContent } from "../lib/newNoteContent";
import { generatedStamp } from "../lib/okfProvenance";
import { defuseNewAddresses } from "./aiWriteLint";

/**
 * "Keep as a note" under an answer (plan KI-Harness P4-6, §17.1 "research
 * capture"): the answer becomes a note of the vault, with what it rests on.
 *
 * The user presses it; the app writes the note — never the model. Three
 * things make the note honest:
 *
 * - It says who wrote it. The frontmatter carries the OKF stamp `generated`
 *   with the model as its actor (ADR 0023 §3), set once, here; the first line
 *   of the body says the same in words.
 * - It names its sources, and the app names them, not the model: the pages
 *   the run actually read and the searches it made — from the run's own
 *   record — and the notes that went along. They stand in `sources` and as a
 *   list under the answer, web and vault apart.
 * - Nothing in it loads or leads anywhere the app did not check. The answer's
 *   text goes through the pre-write linter with no exception: every address
 *   the model wrote is inert there. Where it stood as a link or an image, the
 *   note carries its words with the address beside them as text, so nothing
 *   reads as a link that is none and an image is never an image. The live
 *   links are the ones of the source list, which are addresses the run read
 *   with the user's leave. Wiki links stay: they lead into the vault.
 */

export interface AnswerToCapture {
  question: string;
  /**
   * What the note is called where the question names no topic: a conversation
   * a skill started opens with the skill's own request. The question still
   * stands in the note's first line — it is what was sent.
   */
  title?: string;
  answer: string;
  /** The model that wrote the answer, exactly as it was chosen. */
  model: string;
  /** When the note is written. */
  now: Date;
  /** The pages the run read, as its record has them. */
  pages: readonly { url: string; title: string; at: string }[];
  /** The searches it made, and through whom. */
  searches: readonly { query: string; at: string }[];
  searchProvider: string;
  /** The notes that went along with the question. */
  notes: readonly { path: string; title: string }[];
}

type Translate = (key: string, vars?: Record<string, string>) => string;

/** "2026-10-06 14:32" in the device's time: the same in every language, and it sorts. */
export function captureStamp(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Text that stands inside one line of Markdown: no line break, no bracket that could close a link early. */
function inline(text: string): string {
  return text.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
}

/** A destination the pre-write linter made inert: `https[://]host/…`, `javascript[:]…`, `[//]host/…`. */
const isInertDestination = (destination: string): boolean => /^[a-z][a-z0-9+.-]{0,30}\[:(?:\/\/)?\]/i.test(destination) || destination.startsWith("[//]");

/** How far back a link's words are looked for, and how far forward its address: enough for any real link, and a bound that keeps the scan linear. */
const LABEL_MAX = 400;
const DESTINATION_MAX = 2200;

/**
 * After the linter, an address the model wrote leads and loads nowhere — but
 * its Markdown still says "link" or "image", and a renderer draws a link that
 * goes nowhere and a picture that is none. In a note the user keeps, those
 * are written as what they are: the words, and the address beside them as
 * text. `![chart](https[://]host/p.png)` becomes `chart (https[://]host/p.png)`.
 *
 * This is about how the note reads, never about safety: whatever this pass
 * does not recognise is still inert. Links and embeds that lead into the
 * vault are not touched.
 */
export function flattenInertLinks(text: string): string {
  let out = "";
  let from = 0;
  let at = text.indexOf("](");
  while (at >= 0) {
    // The words: back to their opening bracket on the same line, with brackets inside them counted.
    let open = -1;
    let depth = 0;
    for (let i = at - 1; i >= from && at - i <= LABEL_MAX; i--) {
      const c = text[i];
      if (c === "\n") break;
      if (c === "]") depth++;
      else if (c === "[") {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    // The address: up to the closing parenthesis on the same line.
    let close = -1;
    for (let i = at + 2; i < text.length && i - at <= DESTINATION_MAX; i++) {
      const c = text[i];
      if (c === "\n") break;
      if (c === ")") {
        close = i;
        break;
      }
    }
    if (open >= 0 && close >= 0) {
      const inside = text.slice(at + 2, close).trim();
      const space = inside.search(/\s/);
      const destination = trimChars(space < 0 ? inside : inside.slice(0, space), "<>");
      if (isInertDestination(destination)) {
        const image = open > from && text[open - 1] === "!";
        const words = text.slice(open + 1, at).trim();
        out += text.slice(from, image ? open - 1 : open) + (words && words !== destination ? `${words} (${destination})` : destination);
        from = close + 1;
        at = text.indexOf("](", from);
        continue;
      }
    }
    at = text.indexOf("](", at + 2);
  }
  return out + text.slice(from);
}

/** A page of the source list: the app's own link to an address the run read. */
function pageLine(page: { url: string; title: string; at: string }, t: Translate): string {
  const title = inline(page.title) || page.url.replace(/^https:\/\//, "");
  // A bracket in an address would end the link early in a renderer that does not count them: written as its escape, it is the same address.
  const address = page.url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
  return `- [${title}](${address}) — ${t("ai.capture.read", { date: captureStamp(page.at) })}`;
}

export interface CapturedNote {
  /** The note's name without its extension. */
  stem: string;
  title: string;
  content: string;
  /** Addresses in the answer that were made inert. */
  defused: number;
}

/** The note an answer becomes. Pure: the same answer gives the same note. */
export function captureNote(input: AnswerToCapture, t: Translate): CapturedNote {
  const title = conversationTitleFrom(input.title?.trim() ? inline(input.title) : input.question, t("ai.capture.fallbackTitle"));
  // The file's name is the title without the mark that says it was cut: a name does not end in "…".
  const stem = safeFileStem(title.endsWith("…") ? title.slice(0, -1).trimEnd() : title) ?? safeFileStem(t("ai.capture.fallbackTitle")) ?? "AI answer";
  const linted = defuseNewAddresses(input.answer.trim(), []);
  const pages = input.pages.filter((page, index, all) => all.findIndex((other) => other.url === page.url) === index);
  const notes = input.notes.filter((note, index, all) => /\.md$/i.test(note.path) && all.findIndex((other) => other.path === note.path) === index);

  const body: string[] = [];
  // Who wrote this, in words — the stamp in the frontmatter says it for machines.
  body.push(`> ${t("ai.capture.intro", { model: input.model, date: captureStamp(input.now), question: inline(input.question) })}`);
  body.push(flattenInertLinks(linted.text));
  if (pages.length || input.searches.length || notes.length) {
    body.push(`## ${t("ai.capture.sources")}`);
    if (pages.length || input.searches.length) {
      body.push(
        [
          `**${t("ai.capture.web")}**`,
          "",
          ...pages.map((page) => pageLine(page, t)),
          ...input.searches.map((search) => `- ${t("ai.capture.search", { query: inline(search.query), provider: input.searchProvider, date: captureStamp(search.at) })}`),
        ].join("\n"),
      );
    }
    if (notes.length) {
      body.push([`**${t("ai.capture.vault")}**`, "", ...notes.map((note) => `- [[${note.path.replace(/\.md$/i, "")}|${inline(note.title) || note.path}]]`)].join("\n"));
    }
  }

  let content = buildNewNoteContent("Note", title);
  const sources: OkfSource[] = [
    ...pages.map((page) => ({ resource: page.url, ...(inline(page.title) ? { title: inline(page.title) } : {}) })),
    ...notes.map((note) => ({ resource: note.path, ...(inline(note.title) ? { title: inline(note.title) } : {}) })),
  ];
  // Stamped once, at the moment of creation (ADR 0023 §3). The stamp is the marking: without it nothing is written.
  content = upsertFrontmatterKeys(content, {
    generated: generatedStamp(`plainva-ai/${input.model}`, input.now),
    ...(sources.length ? { sources } : {}),
  });
  content = `${content.trimEnd()}\n\n${body.join("\n\n")}\n`;
  return { stem, title, content, defused: linted.defused };
}

export interface CaptureAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** The folder as the note is written into it: forward slashes, no slash at either end. */
const folderOf = (folder: string): string => trimChars(folder.replace(/\\/g, "/").trim(), "/");

/** A folder as a note is written into it ("" is the vault itself) — the one spelling a place's rules are asked by. */
export const capturedFolder = folderOf;

/** Where the note lands while its name is free: the path its place's rules are asked by. */
export function capturedNotePath(folder: string, stem: string): string {
  const dir = folderOf(folder);
  return `${dir ? `${dir}/` : ""}${stem}.md`;
}

/**
 * The note with the rules it inherits written into it (the plainva namespace,
 * ADR 0018): what was made from a note kept from the cloud, or from the
 * internet, is kept from it too — wherever the new note lies.
 */
export function withInheritedRules(content: string, rules: readonly AiPolicyDimension[]): string {
  let out = content;
  for (const rule of rules) out = setFrontmatterPath(out, ["plainva", "ai", rule], "deny");
  return out;
}

/** Writes the note under a free name in `folder` and returns its path. An existing note is never touched. */
export async function writeCapturedNote(adapter: CaptureAdapter, folder: string, stem: string, content: string): Promise<string> {
  const dir = folderOf(folder);
  const prefix = dir ? `${dir}/` : "";
  if (dir && !(await adapter.exists(dir).catch(() => false))) await adapter.createDir(dir);
  for (let n = 1; n <= 200; n++) {
    const path = `${prefix}${n === 1 ? stem : `${stem} ${n}`}.md`;
    if (await adapter.exists(path)) continue;
    await adapter.writeTextFile(path, content);
    return path;
  }
  throw new Error("no free name for the note");
}
