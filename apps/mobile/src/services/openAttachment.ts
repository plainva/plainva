import { shareVaultFile } from "./shareFile";
import type { MobileVault } from "./vaultService";

/**
 * What happens when an attachment is tapped (S42).
 *
 * An image gets Plainva's viewer; everything else is handed to the system,
 * which knows what a PDF or an .ods is and Plainva does not. Building a
 * viewer per format would be a promise the app cannot keep, and a row that
 * does nothing is worse than one that opens the OS.
 *
 * Its own module because App.tsx is under a structural ratchet: feature
 * decisions belong beside the feature, not in the shell.
 */
export function makeOpenAttachment(
  vault: MobileVault,
  openImage: (path: string) => void,
  onError: () => void,
): (path: string, isImage: boolean) => void {
  return (path, isImage) => {
    if (isImage) openImage(path);
    else void shareVaultFile(vault, path).catch(onError);
  };
}
