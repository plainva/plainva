import type { PimEventRow } from "@plainva/core";
import {
  eventStartDayKey,
  resolveOrCreateMeetingNote,
  type MeetingNoteAdapter,
  type ResolveMeetingNoteResult,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "../settingsStore";
import {
  DEFAULT_MEETING_FOLDER,
  meetingFolderKey,
  meetingNoteTemplateKey,
  templateFolderKey,
} from "../../contexts/VaultContext";
import { getTemplateRules } from "../newNoteTemplate";
import { applyTemplateInteractive, withShellContext } from "../templateInteractive";
import { makeDailyPathProvider } from "../dailyNotes";

/** The OKF type of a meeting note — also what a type rule matches against. */
export const MEETING_NOTE_TYPE = "Meeting";

/**
 * "Termin → Meeting-Notiz" for this vault (plan Befunde 24.09., E24): reads the
 * vault's meetings folder, its meeting-note template and the folder/type rules,
 * and hands them to the shared builder. A person clicked, so the template's
 * questions are asked — `null` means they were cancelled and nothing exists.
 *
 * The phone's twin is `openMeetingNoteFor` in `pimService.ts`; the decision
 * which template applies and what the note carries lives in the shared
 * `resolveOrCreateMeetingNote`, so both write the same note.
 */
export async function openMeetingNoteInVault(
  vaultPath: string,
  adapter: MeetingNoteAdapter,
  event: PimEventRow
): Promise<ResolveMeetingNoteResult | null> {
  const store = await getSettingsStore();
  const folder = ((await store.get<string>(meetingFolderKey(vaultPath))) ?? "").trim() || DEFAULT_MEETING_FOLDER;
  const rules = await getTemplateRules(vaultPath);
  const dayKey = eventStartDayKey(event);
  const now = new Date();
  return resolveOrCreateMeetingNote({
    adapter,
    event,
    dayKey,
    folder,
    noteType: MEETING_NOTE_TYPE,
    templates: {
      template: ((await store.get<string>(meetingNoteTemplateKey(vaultPath))) ?? "").trim(),
      folderRules: rules.folders,
      typeRules: rules.types,
      templateFolder: (await store.get<string>(templateFolderKey(vaultPath))) || "Templates",
    },
    resolveTemplate: async (raw, ctx) =>
      applyTemplateInteractive(
        raw,
        await withShellContext(raw, ctx),
        i18n.t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" })
      ),
    templateContext: {
      vaultName: vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? "",
      // `{{daily}}` in a meeting note is the daily note of the MEETING's day.
      dailyPath: await makeDailyPathProvider(vaultPath, new Date(`${dayKey}T12:00:00`)),
    },
    now,
  });
}
