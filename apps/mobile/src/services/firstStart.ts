import { getVaultTemplates, TOUR_TEMPLATE_ID, type VaultTemplateDefinition } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { currentVaultFolderPlatform, isVaultFolderSupported } from "../platform/vaultFolder";
import { mActions, type MobileSelectOption } from "./mobileDialogs";

/**
 * The phone's half of the first start (plan Oberfläche, O8 / T11, mockup M8).
 *
 * Lifted out of `App.tsx`, which has a line budget, and shared by every place
 * that asks for a structure template (first start, cloud "new vault", the
 * vault list's "Create new vault") — three copies of the same sheet used to
 * live there, and only one of them would have learnt to lead with the tour.
 */

/** The answer of the template sheet: `null` = cancelled; `def: null` = an empty vault. */
export interface TemplatePick {
  id: string;
  def: VaultTemplateDefinition | null;
}

/**
 * The structure-template sheet. The tour comes first and says it is the
 * recommended way in — the desktop's welcome makes it the main action (E5),
 * and the phone's sheet says the same thing in its own form.
 */
export async function pickVaultTemplate(): Promise<TemplatePick | null> {
  const t = i18n.t.bind(i18n);
  const defs = getVaultTemplates(i18n.language);
  const tour = defs.filter((d) => d.id === TOUR_TEMPLATE_ID);
  const rest = defs.filter((d) => d.id !== TOUR_TEMPLATE_ID);
  const options: MobileSelectOption[] = [
    ...tour.map((d) => ({ value: d.id, label: d.name, desc: t("splash.recommended") })),
    { value: "", label: t("splash.emptyVault") },
    ...rest.map((d) => ({ value: d.id, label: d.name })),
  ];
  const pick = await mActions({ title: t("mobile.templatePick"), options });
  if (pick === null) return null;
  return { id: pick, def: defs.find((d) => d.id === pick) ?? null };
}

/** How "I already have a vault" continues. */
export type ExistingVaultWay = "folder" | "cloud";

/**
 * "I already have a vault": a guide per platform, ending in the real ways in.
 *
 * Where the vault lives decides the way — a folder the phone can reach (the
 * Files app on iOS, a folder of Obsidian or Syncthing on Android), a cloud
 * Plainva syncs with, or only a computer, which needs a cloud in between. The
 * sentence names the places of THIS platform, so nobody reads about a Files
 * app they do not have. Without folder access (the web build) only the cloud
 * remains, and the sentence says so instead of offering a dead row.
 */
export async function chooseExistingVault(): Promise<ExistingVaultWay | null> {
  const t = i18n.t.bind(i18n);
  const platform = currentVaultFolderPlatform();
  const folder = isVaultFolderSupported() && platform !== null;
  const options: MobileSelectOption[] = [
    ...(folder
      ? [{
        value: "folder",
        label: t("mobile.vaultCreateFolder"),
        desc: platform === "ios" ? t("mobile.existingVaultFolderIos") : t("mobile.existingVaultFolderAndroid"),
      }]
      : []),
    { value: "cloud", label: t("mobile.onboardingCloudExisting"), desc: t("mobile.onboardingCloudExistingDesc") },
  ];
  const message = !folder
    ? t("mobile.existingVaultGuideCloudOnly")
    : platform === "ios"
      ? t("mobile.existingVaultGuideIos")
      : t("mobile.existingVaultGuideAndroid");
  const way = await mActions({ title: t("mobile.onboardingExisting"), message, options });
  return way === "folder" || way === "cloud" ? way : null;
}
