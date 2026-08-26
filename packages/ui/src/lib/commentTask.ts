/**
 * A comment that turned into work (Stufe D, D11).
 *
 * A remark and a task are different things, and the moment somebody decides a
 * remark has to be DONE is the moment the two need to part company: the task
 * belongs in the task database, where it is scheduled, filtered and ticked off;
 * the conversation belongs on the note, where the passage is.
 *
 * So promoting does NOT move the comment. The thread stays exactly where it
 * was and gains a reply that names the task - which is the only honest way to
 * link them, because the comment log is append-only: an existing body cannot be
 * rewritten to carry a link that did not exist when it was written.
 *
 * The thread also stays OPEN. Promoting says "this became work", not "this is
 * settled" - closing the conversation is still the reader's call, and doing it
 * automatically would hide the reply that just explained where the work went.
 *
 * Everything here is pure: both shells build the same title, the same trailer
 * and the same reply, so a task made on the phone is indistinguishable from one
 * made on the desktop.
 */

/** How long a title may get before it is cut - the same cap the export uses. */
const TITLE_LIMIT = 80;

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cap(text: string): string {
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text;
}

/**
 * The task's name, taken from the comment.
 *
 * The FIRST line, not the whole body: a comment is prose and can run for
 * paragraphs, while a task title is read in a list. Everything else survives in
 * the note the promotion writes, so nothing is lost by cutting here.
 *
 * `@Name` mentions are left as they stand. They are stored as the written name,
 * not as an id, so a title that carries one still reads as a sentence.
 */
export function commentTaskTitle(body: string, fallback: string): string {
  const first = body.split(/\r?\n/).map((line) => flatten(line)).find((line) => line.length > 0);
  return first ? cap(first) : fallback;
}

export interface CommentTaskTrailerInput {
  /** The full opening comment - the title only kept its first line. */
  body: string;
  /** The passage the thread hangs on, or null for a remark about the whole note. */
  quote: string | null;
  /** Collision-safe wiki target of the note (`wikiTargetForPath`). */
  noteTarget: string;
  /** Localized label for the line that links back to the note. */
  sourceLabel: string;
}

/**
 * What the task note carries below its title.
 *
 * Three things, in the order somebody reading the task needs them: the remark
 * in full, the passage it was about, and the way back to the note. The link is
 * a plain wiki link, so the task reaches the conversation with one click and
 * the backlink panel on the note shows the task without anything extra.
 */
export function commentTaskTrailer(input: CommentTaskTrailerInput): string {
  const lines: string[] = [];
  const body = input.body.trim();
  if (body) lines.push("", body);
  const quote = input.quote ? flatten(input.quote) : "";
  if (quote) lines.push("", `> ${cap(quote)}`);
  lines.push("", `${input.sourceLabel}: [[${input.noteTarget}]]`, "");
  return lines.join("\n");
}

/**
 * The reply that keeps the thread pointing at the task.
 *
 * Deliberately one sentence with a link and nothing else: it is a record, not a
 * remark, and it sits in a column where every extra line pushes the actual
 * conversation out of view.
 */
export function commentTaskReply(taskTarget: string, label: string): string {
  return `${label}: [[${taskTarget}]]`;
}
