import { format, parse, isValid } from "date-fns";

/**
 * Pure path builder for daily notes — no I/O, no Tauri/context imports, so it
 * stays unit-testable in a plain Node environment. Converts the user's
 * Moment-style format (e.g. YYYY-MM-DD) to the date-fns equivalent, formats
 * `date`, and joins it with the daily-notes folder.
 */
export function buildDailyNotePath(date: Date, rawFormat: string, folder: string): { fullPath: string; dateStr: string } {
  const dateFormat = rawFormat.replace(/YYYY/g, "yyyy").replace(/YY/g, "yy").replace(/DD/g, "dd").replace(/D/g, "d");
  let dateStr: string;
  try {
    dateStr = format(date, dateFormat);
  } catch {
    dateStr = format(date, "yyyy-MM-dd");
  }
  const fileName = dateStr.endsWith(".md") ? dateStr : `${dateStr}.md`;
  const fullPath = folder ? `${folder.replace(/[/\\]+$/, "")}/${fileName}` : fileName;
  return { fullPath, dateStr };
}

/** Stable local-date key (YYYY-MM-DD) used to mark calendar days. */
export function localIsoKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Inverse of {@link buildDailyNotePath}: given a vault-relative note path, the
 * daily-notes format and folder, returns the date the note represents — or null
 * if the path is not a daily note. Used to highlight the open daily note in the
 * calendar. Pure (no I/O), so it stays unit-testable in plain Node.
 *
 * A round-trip guard makes this safe against false positives: the parsed date
 * must rebuild EXACTLY the same path, so a note merely resembling the format
 * (e.g. `2026-07.md` under a `YYYY-MM-DD` vault) is rejected.
 */
export function parseDailyNoteDate(path: string, rawFormat: string, folder: string): Date | null {
  if (!path) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = norm(path);
  if (!/\.md$/i.test(target)) return null;

  const dateFormat = rawFormat.replace(/YYYY/g, "yyyy").replace(/YY/g, "yy").replace(/DD/g, "dd").replace(/D/g, "d");
  const folderPrefix = folder ? `${norm(folder).replace(/\/+$/, "")}/` : "";
  if (folderPrefix && target.toLowerCase().indexOf(folderPrefix.toLowerCase()) !== 0) return null;

  const dateStr = target.slice(folderPrefix.length).replace(/\.md$/i, "");
  if (!dateStr) return null;

  let parsed: Date;
  try {
    parsed = parse(dateStr, dateFormat, new Date());
  } catch {
    return null;
  }
  if (!isValid(parsed)) return null;

  // Round-trip guard: the parsed date must reproduce this exact path.
  const rebuilt = norm(buildDailyNotePath(parsed, rawFormat, folder).fullPath);
  if (rebuilt.toLowerCase() !== target.toLowerCase()) return null;
  return parsed;
}
