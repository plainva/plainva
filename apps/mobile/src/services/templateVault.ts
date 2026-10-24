import type { TemplateVault } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { getActiveVaultEntry } from "./vaultRegistry";

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
      name = (await getActiveVaultEntry())?.name || "Plainva";
    } catch {
      name = "Plainva";
    }
  }
  const settings = getMobileSettings();
  return { name, dailyFolder: settings.dailyFolder ?? "", dailyFormat: settings.dailyFormat ?? "" };
}
