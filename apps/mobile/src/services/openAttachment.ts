import { resolveOpenAction } from "@plainva/ui";
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
/**
 * Where a tapped vault path belongs (issue #55).
 *
 * Returns true when it has been handled here — a database screen, the image
 * viewer, or the system — so the caller only has to deal with what is left: a
 * note. This is the mobile twin of the desktop's `openInPane` guard, and it sits
 * beside the feature rather than in App because App.tsx is under a structural
 * ratchet, and because the routing question ("what IS this file") belongs next
 * to the answer ("what do we do with it") rather than in the shell.
 *
 * Before this, a tap on `[[Report.pdf]]` opened the note screen on a binary file
 * — and when the title-only lookup did not resolve it at all, the app CREATED
 * `Report.pdf.md`, littering the vault from a link the editor drew as valid.
 */
export function routeVaultPath(
  path: string,
  handlers: {
    openBase: (path: string) => void;
    openAttachment: (path: string, isImage: boolean) => void;
  },
): boolean {
  const action = resolveOpenAction(path);
  if (action === "base") {
    handlers.openBase(path);
    return true;
  }
  if (action === "image" || action === "external") {
    handlers.openAttachment(path, action === "image");
    return true;
  }
  // "editor" and "text" both fall through to the note screen. The phone shows
  // a text file with the same editor as a note today; giving it the plain mode
  // the desktop gets is S14, and until then the difference is cosmetic —
  // whereas sending it to the system here would make the two shells disagree
  // about what a `.csv` IS, which is the split this rule exists to prevent.
  return false;
}

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
