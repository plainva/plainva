/**
 * Whether a link's target can name a NOTE, by its form alone (review O7,
 * third round) — whether a file of that name is there or not, and the same
 * for a wiki link and a Markdown link. Which note it names is the link
 * rule's to say (`resolveLinkTargetIndexed`, ADR 0027); this only rules out
 * what is no note at all:
 *
 *  - an address: a scheme in front (`https:`, `mailto:`, `plainva:`), a
 *    drive (`C:\…`), a share (`\\server\…`), or `www.`. A colon with a blank
 *    behind it is part of a name: `[[Q4: Plan]]` is a note;
 *  - a folder: a target that ends in a slash or in `.`/`..`;
 *  - a file of another kind, by its extension: a picture, a recording, a
 *    film, a PDF, a database, a canvas, a document of another program. A
 *    dotted note name (`[[Node.js]]`, `[[Plan.v2]]`) is a note.
 */

/** What a file that is no note ends in. A missing one is no note to create, and no note a text could rest on. */
export const NOT_A_NOTE_FILE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif|tiff?|ico|mp3|wav|m4a|ogg|oga|opus|flac|aac|webm|mp4|m4v|mov|avi|mkv|ogv|pdf|base|canvas|csv|txt|json|docx?|xlsx?|pptx?|odt|ods|odp|zip)$/i;

/** A scheme with no blank behind its colon: an address, or a drive letter. */
const ADDRESS = /^[a-z][a-z0-9+.-]*:(?!\s)/i;
const FOLDER = /(?:[\\/]|(?:^|[\\/])\.\.?)$/;

export function linkTargetMayNameNote(target: string): boolean {
  const name = target.trim();
  if (!name) return false;
  if (ADDRESS.test(name) || name.startsWith("\\\\") || /^www\./i.test(name)) return false;
  if (FOLDER.test(name)) return false;
  return !NOT_A_NOTE_FILE.test(name);
}
