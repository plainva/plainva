import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import {
  boundaryLabel,
  clampBoundary,
  CommittedTextInput,
  DAY_END_CHOICES,
  GroupCard,
  ICON,
  listTemplates,
  Row,
  RowList,
  sanitizeDailyNoteFormat,
  SectionLabel,
  SettingField,
} from "@plainva/ui";
import { DEFAULT_JOURNAL_HEADING, normalizeJournalHeading } from "@plainva/core";
import { AppBar } from "../components/AppBar";
import { FolderField } from "../components/FolderField";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { useSettingsState } from "../hooks/useSettingsState";
import { mSelect } from "../services/mobileDialogs";
import { dailyNoteTypeOf } from "../services/newNote";
import type { MobileVault } from "../services/vaultService";

/**
 * Daily notes & journal (settings plan 2026-10-29, E9): every vault field the
 * daily note and the journal read, on one screen — as on the desktop. They lay
 * over a folder card, a card without a title and "Daily notes" before; the
 * mood, the heading and the day boundary each sat somewhere else.
 *
 * The device's own journal settings (the place stamp, quick capture) are app
 * settings and stay there; the journal group's info says where.
 */
export function JournalAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsState();
  const [pickFolder, setPickFolder] = useState(false);

  /** When this vault's day ends (plan Journal-Erweiterungen, E1) — the desktop's select, as a sheet. */
  const dayEndLabel = (minutes: number) =>
    clampBoundary(minutes) === 0 ? t("settings.dayEndsAtMidnight") : boundaryLabel(minutes);
  const pickDayEndsAt = () => {
    void mSelect({
      title: t("settings.dayEndsAt"),
      options: DAY_END_CHOICES.map((minutes) => ({ value: String(minutes), label: dayEndLabel(minutes) })),
      value: String(clampBoundary(settings.dayEndsAt)),
    }).then((picked) => {
      if (picked !== null) void update({ dayEndsAt: clampBoundary(Number(picked)) });
    });
  };

  // Daily template (package I, desktop dailyNotesTemplate parity): fresh
  // dailies seed from a template file in the template folder; "—" = none.
  const pickDailyTemplate = () => {
    void (async () => {
      const items = await listTemplates(vault.adapter, settings.templateFolder).catch(() => []);
      const picked = await mSelect({
        title: t("settings.dailyNotesTemplate"),
        options: [
          { value: "", label: "—" },
          ...items.map((it) => {
            const file = it.path.split("/").pop() ?? it.path;
            return { value: file, label: it.title };
          }),
        ],
        value: settings.dailyTemplate,
      });
      if (picked !== null) update({ dailyTemplate: picked });
    })();
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("settings.sectionJournal")} testId="appbar-area-journal" />
      <div className="m-settings">
        <SectionLabel>{t("settings.groupDailyNotes")}</SectionLabel>
        <GroupCard>
          <RowList>
            {/* Normalized when saved, not per keystroke (E23): `|| "Daily"`
                refilled a cleared field while one was still typing. */}
            <FolderField
              label={t("mobile.settingDailyFolder")}
              normalize={(v) => v.trim() || "Daily"}
              onSave={(v) => update({ dailyFolder: v })}
              onPick={() => setPickFolder(true)}
              value={settings.dailyFolder}
            />
            <SettingField hint={t("settings.dailyNotesFormatDesc")} label={t("settings.dailyNotesFormat")}>
              {/* The field owns its draft (TestFlight 2026-09-22, E23): bound to the
                  stored value, every key waited for the asynchronous save and the
                  caret jumped to the end; a second quick key was lost. */}
              <CommittedTextInput
                data-testid="daily-format"
                normalize={sanitizeDailyNoteFormat}
                onSave={(v) => update({ dailyFormat: v })}
                value={settings.dailyFormat}
              />
            </SettingField>
            <Row
              end={<><span className="m-prop-val">{settings.dailyTemplate || "—"}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              info={t("settings.dailyNotesTemplateDesc")}
              onClick={pickDailyTemplate}
              title={t("settings.dailyNotesTemplate")}
            />
            <SettingField info={t("settings.dailyNoteTypeDesc")} label={t("settings.dailyNoteType")}>
              <CommittedTextInput
                normalize={dailyNoteTypeOf}
                onSave={(v) => update({ dailyNoteType: v })}
                placeholder={dailyNoteTypeOf("")}
                value={settings.dailyNoteType}
              />
            </SettingField>
          </RowList>
        </GroupCard>

        <SectionLabel info={{ text: t("settings.groupJournalInfo"), guide: "Journal.md" }}>{t("settings.groupJournal")}</SectionLabel>
        <GroupCard>
          <RowList>
            <SettingField hint={t("settings.journalHeadingHint")} info={t("settings.journalHeadingDesc")} label={t("settings.journalHeading")}>
              <CommittedTextInput
                data-testid="journal-heading"
                normalize={normalizeJournalHeading}
                onSave={(v) => update({ journalHeading: v })}
                placeholder={DEFAULT_JOURNAL_HEADING}
                value={settings.journalHeading}
              />
            </SettingField>
            <SettingField hint={t("settings.journalMoodHint")} info={t("settings.journalMoodDesc")} label={t("settings.journalMood")}>
              <CommittedTextInput
                data-testid="journal-mood-property"
                normalize={(v) => v.trim()}
                onSave={(v) => update({ journalMoodProperty: v })}
                placeholder="stimmung"
                value={settings.journalMoodProperty}
              />
            </SettingField>
            <Row
              end={<><span className="m-prop-val">{dayEndLabel(settings.dayEndsAt)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              info={t("settings.dayEndsAtDesc")}
              onClick={pickDayEndsAt}
              title={t("settings.dayEndsAt")}
            />
          </RowList>
        </GroupCard>
      </div>

      {pickFolder && (
        <FolderPickerSheet
          onClose={() => setPickFolder(false)}
          onPick={(path) => {
            if (path) update({ dailyFolder: path });
          }}
          title={t("settings.browseFolders")}
          vault={vault}
        />
      )}
    </div>
  );
}
