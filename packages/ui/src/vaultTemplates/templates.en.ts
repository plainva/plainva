import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, PARA_STRINGS_EN } from "./paraTemplate";
import { buildAce, ACE_STRINGS_EN } from "./aceTemplate";
import { buildJd, JD_STRINGS_EN } from "./jdTemplate";
import { buildJournal, JOURNAL_STRINGS_EN } from "./journalTemplate";
import { buildGtd, GTD_STRINGS_EN } from "./gtdTemplate";
import { buildZettelkasten, ZK_STRINGS_EN } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_EN } from "./projectTemplate";

/** English template set — also the fallback for languages without their own set.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Relation columns and their reverse
 * counterparts are wired here so the databases show real data as soon as the
 * vault is indexed. This module is the structural reference the other language
 * sets mirror. */
export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_EN),
    buildZettelkasten(ZK_STRINGS_EN),
    buildAce(ACE_STRINGS_EN),
    buildJd(JD_STRINGS_EN),
    buildGtd(GTD_STRINGS_EN),
    buildJournal(JOURNAL_STRINGS_EN),
    buildProject(PROJECT_STRINGS_EN),
  ];
}
