import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, TOUR_STRINGS_DE } from "./plainvaTour";
import { buildPara, PARA_STRINGS_DE } from "./paraTemplate";
import { buildAce, ACE_STRINGS_DE } from "./aceTemplate";
import { buildJd, JD_STRINGS_DE } from "./jdTemplate";
import { buildJournal, JOURNAL_STRINGS_DE } from "./journalTemplate";
import { buildGtd, GTD_STRINGS_DE } from "./gtdTemplate";
import { buildZettelkasten, ZK_STRINGS_DE } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_DE } from "./projectTemplate";

/** German template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/umlaut-free; option VALUES, view names and `.base` file names are fully
 * localized. Relation columns and their reverse counterparts are wired here so
 * the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_DE),
    buildPara(PARA_STRINGS_DE),
    buildZettelkasten(ZK_STRINGS_DE),
    buildAce(ACE_STRINGS_DE),
    buildJd(JD_STRINGS_DE),
    buildGtd(GTD_STRINGS_DE),
    buildJournal(JOURNAL_STRINGS_DE),
    buildProject(PROJECT_STRINGS_DE),
  ];
}
