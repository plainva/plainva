import { Directory, Filesystem } from "@capacitor/filesystem";
import { logDiagnostic, type NewVaultFolderPorts } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { isExistingDirectory } from "../adapters/fileErrors";
import { mConfirm } from "./mobileDialogs";

/**
 * The phone's sandbox behind `writeNewVault` (third review of O8, the
 * desktop's twin is `newVaultFolderDisk.ts`). Nothing here is recursive: a
 * mkdir without `recursive` fails at a folder that is there, and an rmdir
 * without it fails at a folder that is not empty — which keeps a take-back to
 * the failed attempt's own files and folders.
 */
export const sandboxNewVaultPorts: NewVaultFolderPorts = {
  makeDir: async (path) => {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: false });
  },
  removeFile: async (path) => {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  },
  removeEmptyDir: async (path) => {
    await Filesystem.rmdir({ path, directory: Directory.Data, recursive: false });
  },
  forget: async () => {
    /* silent: a vault being made here is registered only after its writing, and the boot vault stays — no app data of it to forget */
  },
};

/** The folder every further container vault lives in — never one of an attempt, so never taken back. */
export async function ensureVaultsFolder(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: "vaults", directory: Directory.Data, recursive: true });
  } catch (error) {
    if (!isExistingDirectory(error)) throw error;
  }
}

/**
 * Writes a new vault's structure, and says it when that fails (third review of
 * O8): the attempt has taken back what it wrote, so a second one starts from
 * the same empty place and gives a whole structure. The person decides whether
 * to try again; the raw error goes to the diagnostics, never on the screen.
 * True once an attempt went through, false when the person stopped.
 */
export async function writeWithRetry(attempt: () => Promise<void>): Promise<boolean> {
  for (;;) {
    try {
      await attempt();
      return true;
    } catch (error) {
      console.error("[newVault] the structure could not be written:", error);
      logDiagnostic("vault", `the structure of a new vault could not be written: ${error instanceof Error ? error.message : String(error)}`);
      const again = await mConfirm({
        title: i18n.t("mobile.vaultTemplateFailedTitle"),
        message: i18n.t("mobile.vaultTemplateFailed"),
        confirmLabel: i18n.t("mobile.vaultTemplateRetry"),
      });
      if (!again) return false;
    }
  }
}
