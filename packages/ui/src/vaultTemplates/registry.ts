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
