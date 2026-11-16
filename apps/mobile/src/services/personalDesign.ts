import { getPlatformServices, PersonalDesignSync, personalDesignScope, templateVaultName, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";
import { getActiveVaultEntry } from "./vaultRegistry";

export async function mobilePersonalDesign(vaultId: string, memberId: string | null = null, label = vaultId, store?: ISettingsStore): Promise<PersonalDesignSync> {
  return new PersonalDesignSync(store ?? await getPlatformServices().loadSettings(), personalDesignScope(vaultId, memberId), label,
    async () => getMobileSettings().customTheme, async design => { await updateMobileSettings({ customTheme: design }); });
}

export async function mobilePersonalDesignForEditor(): Promise<PersonalDesignSync> {
  const vault = await getActiveVaultEntry();
  const { loadMobileWorkspaceRuntime, getMobileWorkspaceStatus } = await import("./mobileWorkspaceSecurity");
  const runtime = await loadMobileWorkspaceRuntime(vault.id);
  if (!runtime && await getMobileWorkspaceStatus(vault.id)) throw new Error("workspace-locked");
  // Named as the app shows the vault, the same rule as the desktop's.
  return mobilePersonalDesign(vault.id, runtime?.memberId ?? null, templateVaultName(vault.name, i18n.t("mobile.vaultLocal")));
}
