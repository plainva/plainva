/**
 * The attachment's MIME type from its file name (S28).
 *
 * It decides how the RECIPIENT's client shows the file — inline, with the right
 * icon, or as an unnamed blob. Two shells guessing separately would mean the
 * same PDF arriving as `application/pdf` from one device and as
 * `application/octet-stream` from the other, so both ask here.
 */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", md: "text/markdown", txt: "text/plain", csv: "text/csv",
  ics: "text/calendar", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip",
};

export function guessAttachmentMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  // An entry of the table itself, never one every object inherits: a file
  // called `constructor` or `notes.__proto__` found a function or an object
  // here, and that went on as the file's type. Names come from other people's
  // mail since a forward carries their files.
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXT, ext) ? MIME_BY_EXT[ext] : "application/octet-stream";
}
