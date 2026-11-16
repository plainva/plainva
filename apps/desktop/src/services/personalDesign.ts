import { PersonalDesignSync, personalDesignScope, type ISettingsStore } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { vaultAppName } from "./vaultNames";
import { getStoredCustomThemeDesign, setStoredCustomTheme } from "./theme";
import { readWorkspaceRuntime } from "./workspaceSecurity/workspaceKeychain";

export async function desktopPersonalDesign(vaultPath: string, memberId: string | null = null, store?: ISettingsStore): Promise<PersonalDesignSync> {
  return new PersonalDesignSync(store ?? await getSettingsStore(), personalDesignScope(vaultPath, memberId),
    await vaultAppName(vaultPath), getStoredCustomThemeDesign, setStoredCustomTheme);
}

/** A locked workspace cannot be treated as a single-person plain vault. */
export async function desktopPersonalDesignForEditor(vaultPath: string): Promise<PersonalDesignSync> {
  const access = await readWorkspaceRuntime(vaultPath);
  if (access.state === "locked") throw new Error("workspace-locked");
  return desktopPersonalDesign(vaultPath, access.state === "unlocked" ? access.runtime.memberId : null);
}
