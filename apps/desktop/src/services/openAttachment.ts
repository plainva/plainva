import type { IVaultAdapter } from "@plainva/core";
import { errorText, toast } from "@plainva/ui";

/**
 * Hand an attachment to the operating system (issue #55).
 *
 * WHAT to do with a path is decided by `resolveOpenAction` in the shared
 * package; this is the desktop half of HOW — the opener call plus the one case
 * that stays visible in Plainva, namely failure. Both places that render a vault
 * path (the pane layout and the peek window) call this, so the message and the
 * logging exist once. Its mobile sibling is `services/openAttachment.ts` in the
 * mobile app, which shares the file, not the code: there the system is reached
 * through the share sheet.
 */
export async function openAttachmentExternally(
  vaultPath: string,
  relPath: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  adapter?: Pick<IVaultAdapter, "realPath"> | null,
): Promise<void> {
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    // The path is an identity (NFC, ADR 0016); the file may be stored under
    // another spelling, which a byte-exact file system (Linux, Windows) would
    // not find. The adapter knows the stored one.
    const stored = adapter?.realPath ? await adapter.realPath(relPath) : relPath;
    await openPath(`${vaultPath}/${stored}`);
  } catch (e) {
    console.error("[openAttachment] handing the file to the system failed", e);
    // Naming the file AND the reason: "could not be opened" on its own leaves
    // the user with nothing to act on, and the usual cause — no program is
    // registered for this type — is something only they can fix.
    toast.error(
      t("editor.openExternallyFailed", {
        defaultValue: "„{{name}}“ konnte nicht geöffnet werden: {{error}}",
        name: relPath.split("/").pop() ?? relPath,
        error: errorText(e),
      }),
    );
  }
}
