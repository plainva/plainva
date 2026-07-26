/**
 * Turns arbitrary user text into a safe file-name stem. Shared because three
 * unrelated features need the exact same rule — database files, meeting notes
 * and captured e-mails — and a second copy would drift on the Windows edge
 * cases (reserved characters, a trailing dot colliding with the extension).
 */
export function safeFileStem(name: string): string | null {
  const stem = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot would collide with the ".base" extension on Windows.
    .replace(/\.+$/, "");
  return stem.length > 0 ? stem : null;
}
