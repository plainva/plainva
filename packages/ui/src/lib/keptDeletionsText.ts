import i18n from "../i18n";

/** How many names the notice spells out before it stops with "…". */
export const KEPT_DELETIONS_NAMES_SHOWN = 3;

/**
 * What both shells say when the sync kept files the cloud had deleted, because
 * they carried changes of this device (finding 2026-10-19). The notice names
 * the files and what happens to them — they go up again — so it can be acted
 * on; the worker carries each file up in the same cycle, so the same file is
 * not announced twice. Returns null when there is nothing to say.
 */
export function keptDeletionsText(paths: ReadonlyArray<string>): string | null {
  if (paths.length === 0) return null;
  const names = paths.slice(0, KEPT_DELETIONS_NAMES_SHOWN).map(fileName);
  const more = paths.length > KEPT_DELETIONS_NAMES_SHOWN ? ", …" : "";
  return i18n.t("sync.deletionsKeptLocalEdits", { count: paths.length, names: names.join(", ") + more });
}

/** The one line the diagnostics log keeps of it — English, with the vault-relative paths. */
export function keptDeletionsDiagnostic(paths: ReadonlyArray<string>): string {
  return `kept ${paths.length} file(s) deleted on the remote because they carried unsynced edits; uploading them again: ${paths.join(", ")}`;
}

function fileName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
