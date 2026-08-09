import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, SettingCard, SettingCardNote, SettingRow, Switch } from "@plainva/ui";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { Select } from "../Select";
import {
  DEFAULT_REMINDER_SETTINGS,
  loadReminderSettings,
  remindEventsKey,
  reminderAllDayAtKey,
  reminderAllDayLeadKey,
  reminderCalendarsKey,
  reminderLeadKey,
  remindTasksKey,
  type ReminderSettings as Settings,
} from "../../services/reminderSettings";

/**
 * Reminder settings inside the calendar area (S11b).
 *
 * Same five rows as the phone, in the same order, reading the same settings —
 * what differs is the sentence underneath, because the mechanism differs: the
 * phone hands its reminders to the operating system, the desktop wakes them
 * itself and therefore needs to be running. Saying that is the point; claiming
 * a reliability that does not exist without background operation would be the
 * failure.
 */

const LEAD_CHOICES = [0, 5, 10, 15, 30, 60, 120];
const ALL_DAY_CHOICES = [
  { leadDays: 1, atMinutes: 19 * 60 },
  { leadDays: 0, atMinutes: 8 * 60 },
];

export function ReminderSettings() {
  const { t } = useTranslation();
  const { vaultPath, pimRuntime } = useVault();
  const [settings, setSettings] = useState<Settings>(DEFAULT_REMINDER_SETTINGS);
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<(PimCalendar & { accountId: string })[]>([]);

  // Reads its own calendars rather than taking them as props: the filter is
  // about which calendars EXIST, and the cache is where that is known.
  useEffect(() => {
    let alive = true;
    const cache = pimRuntime?.cache;
    if (!cache) return;
    void (async () => {
      const [a, c] = await Promise.all([cache.listAccounts(), cache.listCalendars()]);
      if (alive) {
        setAccounts(a);
        setCalendars(c);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pimRuntime]);

  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const loaded = await loadReminderSettings(await getSettingsStore(), vaultPath);
      if (alive) setSettings(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  const save = useCallback(
    async (next: Settings, key: string, value: unknown) => {
      setSettings(next);
      if (!vaultPath) return;
      const store = await getSettingsStore();
      await store.set(key, value);
      await store.save();
      // Let the running scheduler re-plan without a restart.
      window.dispatchEvent(new CustomEvent("plainva-reminders-changed"));
    },
    [vaultPath]
  );

  const leadLabel = (minutes: number) =>
    minutes === 0 ? t("reminders.leadAtStart") : t("reminders.leadValue", { count: minutes });

  /** The label names the time of day, so the placeholder must be filled —
   * a screenshot caught `{{time}}` standing in the settings verbatim. */
  const allDayLabel = (choice: { leadDays: number; atMinutes: number }) =>
    t(choice.leadDays > 0 ? "reminders.allDayEvening" : "reminders.allDayMorning", {
      time: `${String(Math.floor(choice.atMinutes / 60)).padStart(2, "0")}:${String(choice.atMinutes % 60).padStart(2, "0")}`,
    });

  const calendarOptions = calendars.map((c) => ({
    key: `${c.accountId} ${c.id}`,
    label: accounts.length > 1 ? `${c.name} · ${accounts.find((a) => a.id === c.accountId)?.label ?? ""}` : c.name,
  }));

  const toggleCalendar = (key: string, on: boolean) => {
    const current = settings.calendars.length > 0 ? settings.calendars : calendarOptions.map((c) => c.key);
    const next = on ? [...new Set([...current, key])] : current.filter((k) => k !== key);
    // Unticking the last one would mean "all" again — refuse rather than
    // silently reinterpret it. An empty list is how "all" is stored, and the
    // person means the opposite when they clear the last tick.
    if (next.length === 0) return;
    const all = next.length === calendarOptions.length;
    void save({ ...settings, calendars: all ? [] : next }, reminderCalendarsKey(vaultPath ?? ""), all ? [] : next);
  };

  const selected = new Set(settings.calendars);
  const allSelected = selected.size === 0;

  return (
    <SettingCard label={t("reminders.section")}>
      <SettingRow label={t("reminders.enable")}>
        <Switch
          checked={settings.enabled}
          label={t("reminders.enable")}
          onChange={(on) => void save({ ...settings, enabled: on }, remindEventsKey(vaultPath ?? ""), on)}
        />
      </SettingRow>

      {settings.enabled && (
        <>
          <SettingRow label={t("reminders.lead")}>
            <Select
              ariaLabel={t("reminders.lead")}
              value={String(settings.rule.defaultLeadMinutes)}
              onChange={(v) =>
                void save(
                  { ...settings, rule: { ...settings.rule, defaultLeadMinutes: Number(v) } },
                  reminderLeadKey(vaultPath ?? ""),
                  Number(v)
                )
              }
              options={LEAD_CHOICES.map((m) => ({ value: String(m), label: leadLabel(m) }))}
              data-testid="reminder-lead"
            />
          </SettingRow>

          <SettingRow label={t("reminders.allDay")}>
            <Select
              ariaLabel={t("reminders.allDay")}
              value={String(settings.rule.allDayLeadDays)}
              onChange={(v) => {
                const choice = ALL_DAY_CHOICES.find((c) => String(c.leadDays) === v) ?? ALL_DAY_CHOICES[0];
                const next = {
                  ...settings,
                  rule: { ...settings.rule, allDayLeadDays: choice.leadDays, allDayAtMinutes: choice.atMinutes },
                };
                setSettings(next);
                void (async () => {
                  if (!vaultPath) return;
                  const store = await getSettingsStore();
                  await store.set(reminderAllDayLeadKey(vaultPath), choice.leadDays);
                  await store.set(reminderAllDayAtKey(vaultPath), choice.atMinutes);
                  await store.save();
                  window.dispatchEvent(new CustomEvent("plainva-reminders-changed"));
                })();
              }}
              options={ALL_DAY_CHOICES.map((c) => ({ value: String(c.leadDays), label: allDayLabel(c) }))}
              data-testid="reminder-allday"
            />
          </SettingRow>

          <SettingRow label={t("reminders.tasks")}>
            <Switch
              checked={settings.tasks}
              label={t("reminders.tasks")}
              onChange={(on) => void save({ ...settings, tasks: on }, remindTasksKey(vaultPath ?? ""), on)}
            />
          </SettingRow>

          {calendarOptions.length > 1 && (
            <SettingRow
              label={t("reminders.calendars")}
              desc={allSelected ? t("reminders.calendarsAll") : t("reminders.calendarsSome", { count: selected.size, total: calendarOptions.length })}
              wide
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }} data-testid="reminder-calendars">
                {calendarOptions.map((c) => (
                  <Checkbox
                    key={c.key}
                    checked={allSelected || selected.has(c.key)}
                    onChange={(e) => toggleCalendar(c.key, e.currentTarget.checked)}
                  >
                    {c.label}
                  </Checkbox>
                ))}
              </div>
            </SettingRow>
          )}

          <SettingCardNote>{t("reminders.desktopWindow")}</SettingCardNote>
        </>
      )}
    </SettingCard>
  );
}
