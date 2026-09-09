/** Native filesystem errors use codes; the web plugin has exact English messages. */
function matches(error: unknown, codes: readonly string[], messages: readonly string[]): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  // A supplied error code is authoritative: permission failures must never be
  // reclassified because their message happens to mention a missing file.
  if (typeof code === "string") return codes.includes(code);
  return typeof message === "string" && messages.includes(message);
}

export function isMissingFile(error: unknown): boolean {
  return matches(error, ["ENOENT", "OS-PLUG-FILE-0008"], [
    "ENOENT", "File does not exist.", "Entry does not exist.", "Folder does not exist.",
  ]);
}

export function isExistingDirectory(error: unknown): boolean {
  return matches(error, ["EEXIST", "OS-PLUG-FILE-0010"], ["Current directory does already exist."]);
}
