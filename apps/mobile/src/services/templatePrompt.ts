import { createTemplateIn, errorText, toast } from "@plainva/ui";
import type { TFunction } from "i18next";
import { mPrompt } from "./mobileDialogs";
import { getMobileSettings } from "./mobileSettings";
import { configuredNoteType } from "./newNote";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * "Create a template" on the phone (parity gap template-authoring).
 *
 * The desktop has had this in the palette and the .base menu since 2026-07-03;
 * the phone could only USE templates. The rules are the shared ones — this
 * only asks for a name and supplies the two settings the phone keeps, because
 * the two shells store them differently.
 *
 * Returns the new template's path, or null when the user cancelled or the
 * folder could not be created.
 */
export async function createTemplatePrompt(
  vault: MobileVault,
  t: TFunction,
): Promise<string | null> {
  const { value, cancelled } = await mPrompt({
    title: t("database.createTemplate"),
    initial: t("database.newTemplateName"),
  });
  const name = value?.trim().replace(/[\\/]/g, "-");
  if (cancelled || !name) return null;

  // A template that could not be written says so, with its reason, as the
  // desktop says it (Sammelplan § 3.134 no. 3) — "Export failed." stood here.
  try {
    return await createTemplateIn(
      vault.files,
      { folder: getMobileSettings().templateFolder, noteType: configuredNoteType() },
      name,
    );
  } catch (e) {
    toast.error(t("writeFailed.newTemplate", { reason: errorText(e) }));
    return null;
  }
}

/**
 * "New note from a template" (R3.4): pick a template, name the note, land in
 * the editor — full template text, placeholders interpolated by vaultOps.
 *
 * Moved here out of App.tsx to sit next to its sibling action (and because the
 * structure ratchet is right that a feature block belongs in a module).
 * Returns the new note's path, or null when cancelled.
 */
export async function newNoteFromTemplate(
  vault: MobileVault,
  t: TFunction,
  item: { path: string; title: string },
  folder: string,
): Promise<string | null> {
  const raw = await vaultOps.read(vault, item.path);
  const { value, cancelled } = await mPrompt({
    title: t("mobile.newFromTemplate"),
    initial: item.title,
  });
  const name = value?.trim().replace(/[\\/]/g, "-");
  if (cancelled || !name) return null;
  return vaultOps.createNoteFromTemplate(vault, folder, name, raw);
}
