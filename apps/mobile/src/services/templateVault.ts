import type { TemplateVault } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { getActiveVaultEntry } from "./vaultRegistry";
import { vaultEntryName } from "./vaultEntryName";

/**
 * What the open vault hands every template on the phone (Sammelplan § 3.97):
 * its name for `{{vault}}`, and the folder and format of its daily notes for
 * `{{daily±N}}`. A caller that knows the name already hands it in.
 *
 * Never throws. The ways that ask for it run in the background too — the task
 * sync, a promoted checkbox, a shared text —, and a registry that cannot be
 * read must not stop a cycle or a note over a name: the name is then the
 * app's, as the callers always wrote it.
 */
export async function phoneTemplateVault(vaultName?: string): Promise<TemplateVault> {
  let name = vaultName;
  if (name === undefined) {
    try {
      // The name the vault goes by in the app, as on the desktop (B25): the
      // vault list's own, or what the list shows for an entry without one.
      name = vaultEntryName((await getActiveVaultEntry())?.name);
    } catch {
      name = "Plainva";
    }
  }
  const settings = getMobileSettings();
  return { name, dailyFolder: settings.dailyFolder ?? "", dailyFormat: settings.dailyFormat ?? "" };
}
