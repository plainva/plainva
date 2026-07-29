/**
 * Where a dropped, pasted or photographed file lands (plan P5, step S17).
 *
 * Until now every shell decided this for itself, and both decided "beside the
 * note": drop a screenshot into a note in `Projects/2026/` and the image landed
 * in `Projects/2026/`. That is defensible for one note and unbearable for a
 * vault — the attachments end up scattered across every folder that ever
 * received one, and moving a note leaves them behind.
 *
 * So the folder is a setting now, with `Attachments` as the default, and this
 * module is the one place that turns it into a path. Deliberately without I/O
 * of its own: the caller passes an `exists` probe, which keeps the naming rules
 * testable in plain Node and identical on both platforms.
 */

/** Strips slashes and trailing dots so a name can never escape its folder. */
export function sanitizeAttachmentName(raw: string): string {
  return raw.trim().replace(/[\\/]/g, "-").replace(/^\.+/, "").trim();
}

/**
 * A name for a file that arrived without one — pasted image data carries bytes
 * and a MIME type, nothing else. Local time on purpose: the stamp is there so a
 * person recognises their own paste, not for sorting across time zones.
 */
export function pastedAttachmentName(mime: string, now: Date): string {
  const ext = (mime.split("/")[1] || "png").replace("+xml", "").replace(/[^a-z0-9]/gi, "") || "png";
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  return `Pasted-${stamp}.${ext}`;
}

/**
 * The folder attachments go into: the configured one, or beside the note when
 * it is empty. An empty setting is a deliberate choice, not a missing value —
 * it restores the behaviour Plainva had before this setting existed.
 */
export function attachmentFolderFor(configured: string, noteFolder: string): string {
  const folder = (configured || "").trim().replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  return folder || noteFolder;
}

/**
 * The first free path in that folder. Numbering rather than overwriting: two
 * screenshots named `Screenshot.png` are two different files, and silently
 * replacing the first one would destroy something the user cannot get back.
 */
export async function uniqueAttachmentPath(
  folder: string,
  fileName: string,
  exists: (path: string) => Promise<boolean>
): Promise<string> {
  const name = sanitizeAttachmentName(fileName) || "file";
  const join = (n: string) => (folder ? `${folder}/${n}` : n);
  if (!(await exists(join(name)))) return join(name);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = join(`${stem}-${n}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  // A thousand collisions is not a naming problem any more; fall back to the
  // stamp so the write still succeeds instead of looping.
  return join(`${stem}-${Date.now()}${ext}`);
}

/** Everything above in one call: the path a new attachment should be written to. */
export async function resolveAttachmentPath(
  opts: { configuredFolder: string; noteFolder: string; fileName: string; mime: string; now?: Date },
  exists: (path: string) => Promise<boolean>
): Promise<string> {
  const name = sanitizeAttachmentName(opts.fileName) || pastedAttachmentName(opts.mime, opts.now ?? new Date());
  return uniqueAttachmentPath(attachmentFolderFor(opts.configuredFolder, opts.noteFolder), name, exists);
}
