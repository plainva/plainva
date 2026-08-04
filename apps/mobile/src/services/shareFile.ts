import { Share } from "@capacitor/share";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { mimeTypeForPath } from "@plainva/core";
import type { MobileVault } from "./vaultService";

/**
 * Hands a vault file to another app (S42).
 *
 * This is the phone's answer to the desktop's "print / export / open in
 * another app": the system share sheet already contains Print, Save to Files,
 * Mail and every editor installed. Building a separate print path on top of
 * that would be a second, worse copy of a thing the OS does well.
 *
 * The file is staged in the app's cache rather than shared from the vault
 * directly, because the vault may live in a sandbox the receiving app cannot
 * read — and because a share must never hand out a writable handle to the
 * user's actual note.
 */
export async function shareVaultFile(vault: MobileVault, path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  const bytes = await vault.files.readBinaryFile(path);

  if (Capacitor.getPlatform() === "web") {
    // The dev/browser build has no share sheet; a download is the honest
    // equivalent and keeps the button from doing nothing there.
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeTypeForPath(path) }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const staged = `share/${name}`;
  await Filesystem.mkdir({ path: "share", directory: Directory.Cache, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path: staged, data: btoa(binary), directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: staged, directory: Directory.Cache });
  try {
    await Share.share({ title: name, url: uri });
  } catch {
    // Dismissing the sheet is not a failure.
  }
}
