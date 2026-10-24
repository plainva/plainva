import { readNoteLinks, type PimEventRow, type VaultQueryService } from "@plainva/core";
import { brokenLinkLabel, brokenLinkNotePath, type BrokenLinkToCreate } from "../services/graphActions";

/**
 * What a shell gives the calm hints at the open note (plan KI-Harness P8-3):
 * which links of a note lead nowhere, today's daily note, tomorrow's
 * appointments, and the steps — each the way the app already takes it. The
 * session decides what to show; the shell knows its index, its calendar and
 * its writes.
 */
export interface NoteHintsHost {
  /** The links of a note's text that lead to no note a note could be created for, by the rule a click follows. */
  brokenLinks(path: string, content: string): Promise<BrokenLinkInNote[]>;
  /** Whether the note is today's daily note: only there do tomorrow's appointments count. */
  isTodaysDailyNote(path: string): Promise<boolean>;
  /** Tomorrow's appointments that no note is anchored to (`plainva.pim`), in the order of the day. */
  meetingsTomorrow(): Promise<PimEventRow[]>;
  /** "Create note": the note a broken link names, where the link will find it. Answers its path. */
  createLinkTarget(link: BrokenLinkToCreate): Promise<string | null>;
  /** "As a task": that line where it stands, through the chain's one entry. False where the line is no longer that line. */
  todoAsTask(path: string, line: number, raw: string): Promise<boolean>;
  /** "Create meeting note": the calendar's way, template and anchor included. Answers the note's path; null where the template's questions were cancelled. */
  createMeetingNote(event: PimEventRow): Promise<string | null>;
}

/** A link of a note that leads nowhere: as the lists show it, the line it first stands on, and what creating its note needs. */
export interface BrokenLinkInNote {
  label: string;
  line: number;
  link: BrokenLinkToCreate;
}

/**
 * What a link names when it names a file that is no note — a picture, a
 * recording, a film, a PDF, a database, a canvas, a document of another
 * program. A missing one is no note to create: "Create note" made
 * `shot.png.md` for a missing `![[shot.png]]`. A dotted note name
 * (`[[Plan.v2]]`) is a note.
 */
const NOT_A_NOTE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif|tiff?|ico|mp3|wav|m4a|ogg|oga|opus|flac|aac|webm|mp4|m4v|mov|avi|mkv|ogv|pdf|base|canvas|csv|txt|json|docx?|xlsx?|pptx?|odt|ods|odp|zip)$/i;

/**
 * The links of a note's text that lead to no note — asked of the index by the
 * rule a click follows (`resolveNotePath`, `resolveMarkdownLink`) — each once,
 * with the line it first stands on. Only links a note can be created for: a
 * missing picture or a Markdown link to a PDF is not a note's to create.
 */
export async function brokenLinksIn(query: Pick<VaultQueryService, "resolveNotePath" | "resolveMarkdownLink">, path: string, content: string): Promise<BrokenLinkInNote[]> {
  const out: BrokenLinkInNote[] = [];
  const seen = new Set<string>();
  // Lines counted once, as the links come in the order of the text.
  let line = 1;
  let counted = 0;
  for (const link of readNoteLinks(content).links) {
    for (; counted < link.start && counted < content.length; counted++) if (content.charCodeAt(counted) === 10) line++;
    if (!link.target) continue;
    const kind = link.type;
    const targetRaw = kind === "markdown-link" ? content.slice(link.targetStart, link.targetEnd) : link.inner.split("|")[0]!.trim();
    const toCreate: BrokenLinkToCreate = { sourcePath: path, targetRaw, target: link.target, kind };
    if (kind !== "markdown-link" && NOT_A_NOTE.test(link.target)) continue;
    if (!brokenLinkNotePath(toCreate)) continue;
    const resolved = kind === "markdown-link" ? await query.resolveMarkdownLink(link.target, path) : await query.resolveNotePath(link.target, path);
    if (resolved) continue;
    const label = brokenLinkLabel(toCreate);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, line, link: toCreate });
  }
  return out;
}

/**
 * Tomorrow's appointments no note is anchored to: the calendar's rows of the
 * day after `now`, without the ones whose uid a note's `plainva.pim` anchor
 * names (`VaultQueryService.getTaskAnchors`) — the anchor the meeting note
 * writes.
 */
export async function meetingsWithoutNote(rows: readonly PimEventRow[], anchors: () => Promise<ReadonlyMap<string, unknown>>): Promise<PimEventRow[]> {
  if (rows.length === 0) return [];
  const anchored = await anchors().catch(() => new Map<string, unknown>());
  return rows.filter((row) => row.uid && !anchored.has(row.uid)).sort((a, b) => a.start.ts - b.start.ts);
}
