type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What a folder row says it holds (finding X10, review 2026-11-10).
 *
 * The row counted notes only, so a folder of two pictures said "0 notes" — as
 * if it were empty. Notes stay the first word; attachments join them when
 * there are any, and stand alone in a folder that holds nothing else.
 */
export function folderContents(t: Translate, notes: number, files: number): string {
  if (files === 0) return t("mobile.folderCount", { count: notes });
  if (notes === 0) return t("mobile.attachmentCount", { count: files });
  return `${t("mobile.folderCount", { count: notes })} · ${t("mobile.attachmentCount", { count: files })}`;
}
