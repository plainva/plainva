import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Saving the `.pvrecovery` package on a phone (first setup / renewal).
 *
 * This file is the ONE artifact that cannot be regenerated, so it is written to
 * a PERSISTENT location first (Documents — Cache can be purged by the OS at any
 * time) and only then offered to the share sheet, so the user can additionally
 * put it into a password manager or another cloud. "Saved" therefore means the
 * write succeeded; cancelling the share sheet does not undo it.
 */

/** Uint8Array → base64 in chunks (a big file must not blow the call stack). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function recoveryFileName(now = new Date()): string {
  return `Plainva-Recovery-${now.toISOString().slice(0, 10)}.pvrecovery`;
}

export interface SavedRecoveryFile {
  name: string;
  /** Native only: where the copy that survives the share sheet lives. */
  uri: string | null;
}

export async function saveRecoveryFile(bytes: Uint8Array, name = recoveryFileName()): Promise<SavedRecoveryFile> {
  if (Capacitor.getPlatform() === "web") {
    // Dev-server fallback: a plain download.
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { name, uri: null };
  }
  await Filesystem.writeFile({ path: name, directory: Directory.Documents, data: toBase64(bytes), recursive: true });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Documents });
  // The sheet is the second copy, not the save itself — a cancelled or missing
  // share target must never make the caller think nothing was written.
  try { await Share.share({ title: name, url: uri }); } catch { /* user cancelled */ }
  return { name, uri };
}
