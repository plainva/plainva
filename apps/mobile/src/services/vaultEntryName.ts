import { templateVaultName } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The name a vault of the list goes by on the phone (B25, F7 of release
 * 0.9.0): its own, or what the list shows for an entry without one. The
 * header, the vault list, the boot screen, a transfer's review and every
 * template name it so — one rule, the desktop's (`templateVaultName`).
 *
 * A module of its own: the screens and services that name a vault need
 * nothing else of the vault registry or the settings for it.
 */
export function vaultEntryName(name: string | null | undefined): string {
  return templateVaultName(name, i18n.t("mobile.vaultLocal"));
}
