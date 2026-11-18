import { matchAppLanguage } from "../services/languages";
import type { VaultTemplateDefinition } from "./types";
import { templates as templatesDe } from "./templates.de";
import { templates as templatesEn } from "./templates.en";
import { templates as templatesEs } from "./templates.es";
import { templates as templatesFr } from "./templates.fr";
import { templates as templatesIt } from "./templates.it";
import { templates as templatesJa } from "./templates.ja";
import { templates as templatesNl } from "./templates.nl";
import { templates as templatesPl } from "./templates.pl";
import { templates as templatesPtBr } from "./templates.pt-BR";
import { templates as templatesZhCn } from "./templates.zh-CN";

/**
 * Shared vault-template registry (M3E package I): the ten language modules
 * and their lookup, lifted from the desktop scaffolder so both shells offer
 * the same starting structures. The desktop keeps its Tauri scaffolder; the
 * mobile one writes through the vault adapter chain.
 */

const TEMPLATES_BY_LANGUAGE: Record<string, () => VaultTemplateDefinition[]> = {
  de: templatesDe,
  en: templatesEn,
  es: templatesEs,
  fr: templatesFr,
  it: templatesIt,
  ja: templatesJa,
  nl: templatesNl,
  pl: templatesPl,
  "pt-BR": templatesPtBr,
  "zh-CN": templatesZhCn,
};

/** Localized template set — folder/file names follow the app language. */
export function getVaultTemplates(language: string): VaultTemplateDefinition[] {
  const set = TEMPLATES_BY_LANGUAGE[matchAppLanguage(language)];
  return (set ?? templatesEn)();
}

/**
 * The template the first start leads with (plan Oberfläche, O8 / E5): the
 * tour shows what Plainva can do instead of explaining it, so it is the main
 * way in on the desktop's welcome and the recommended entry of the phone's
 * template sheet. One id for both shells.
 */
export const TOUR_TEMPLATE_ID = "plainva" as const;

/** The tour in the app language — always present in every language set. */
export function getTourTemplate(language: string): VaultTemplateDefinition {
  const tour = getVaultTemplates(language).find((d) => d.id === TOUR_TEMPLATE_ID);
  if (!tour) throw new Error("The tour template is missing from the template set");
  return tour;
}
