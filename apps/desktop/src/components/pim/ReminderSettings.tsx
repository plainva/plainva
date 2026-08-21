import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Checkbox,
  reminderDiagnosis,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  TextInput,
} from "@plainva/ui";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { reminderStateStore } from "../../services/reminderScheduler";
import { offerBackgroundOnce } from "../settings/BackgroundSettings";
import { Select } from "../Select";
import {
  DEFAULT_REMINDER_SETTINGS,
  loadReminderSettings,
  remindEventsKey,
  reminderAllDayAtKey,
  reminderAllDayLeadKey,
  reminderCalendarsKey,
  reminderLeadKey,
  reminderTaskAtKey,
  reminderTaskLeadKey,
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

/** Minutes since midnight ↔ "09:00". Local wall-clock: this is a rule ("every
 *  morning at nine"), not an instant, so no time zone is involved. */
const toField = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function fromField(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/**
 * A day and a time as one row (plan Mobile-Feedback, E1).
 *
 * Both all-day rules used to be a Select over two fixed combinations, which hid
 * the two questions and made every hour but those two unreachable. Here the day
 * is a choice and the hour is free, and the row's own description spells out the
 * resulting sentence — the reader should not have to combine the halves in
 * their head to find out when it goes off.
 */
function DayTimeRow({
  label,
  days,
  day,
  minutes,
  preview,
  testId,
  onChange,
}: {
  label: string;
  days: Array<{ value: number; label: string }>;
  day: number;
  minutes: number;
  preview: (day: number, minutes: number) => string;
  testId: string;
  onChange: (day: number, minutes: number) => void;
}) {
  return (
    <SettingRow label={label} desc={preview(day, minutes)}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <Select
          ariaLabel={label}
          value={String(day)}
          onChange={(v) => onChange(Number(v), minutes)}
          options={days.map((d) => ({ value: String(d.value), label: d.label }))}
          data-testid={testId}
        />
        <TextInput
          aria-label={label}
          type="time"
          value={toField(minutes)}
          onChange={(e) => {
            const next = fromField(e.target.value);
            if (next !== null) onChange(day, next);
          }}
          data-testid={`${testId}-time`}
        />
      </div>
    </SettingRow>
  );
}

export function ReminderSettings() {
  // What the last planning run produced, so a zero can be told from a fault
  // (plan Mobile-Feedback, P1/5). Subscribed here and nowhere higher: the
  // scheduler ticks every five minutes and must not re-render the app.
  const runState = useSyncExternalStore(reminderStateStore.subscribe, reminderStateStore.get);
  const { t, i18n } = useTranslation();
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

  /**
   * Writes a rule change. Takes a partial because a day and a time are ONE
   * decision — saving them separately would let a half-applied rule reach the
   * scheduler between the two writes.
   */
  const saveRule = useCallback(
    (patch: Partial<Settings["rule"]>) => {
      const rule = { ...settings.rule, ...patch };
      setSettings({ ...settings, rule });
      void (async () => {
        if (!vaultPath) return;
        const store = await getSettingsStore();
        if (patch.allDayLeadDays !== undefined) await store.set(reminderAllDayLeadKey(vaultPath), rule.allDayLeadDays);
        if (patch.allDayAtMinutes !== undefined) await store.set(reminderAllDayAtKey(vaultPath), rule.allDayAtMinutes);
        if (patch.taskLeadDays !== undefined) await store.set(reminderTaskLeadKey(vaultPath), rule.taskLeadDays);
        if (patch.taskAtMinutes !== undefined) await store.set(reminderTaskAtKey(vaultPath), rule.taskAtMinutes);
        await store.save();
        window.dispatchEvent(new CustomEvent("plainva-reminders-changed"));
      })();
    },
    [settings, vaultPath]
  );

  const leadLabel = (minutes: number) =>
    minutes === 0 ? t("reminders.leadAtStart") : t("reminders.leadValue", { count: minutes });

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
  const diagnosis = reminderDiagnosis(runState, (ts) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts))
  );

  return (
    <SettingCard label={t("reminders.section")}>
      <SettingRow label={t("reminders.enable")}>
        <Switch
          checked={settings.enabled}
          label={t("reminders.enable")}
          onChange={(on) => {
            void save({ ...settings, enabled: on }, remindEventsKey(vaultPath ?? ""), on);
            // The offer belongs here, where it has a reason: reminders only
            // appear while Plainva runs, so this is the moment staying in the
            // background means something. Asked once, never taken unasked.
            if (on) void offerBackgroundOnce(t);
          }}
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

          <DayTimeRow
            label={t("reminders.allDay")}
            days={[
              { value: 1, label: t("reminders.dayBeforeEvent") },
              { value: 0, label: t("reminders.dayOfEvent") },
            ]}
            day={settings.rule.allDayLeadDays}
            minutes={settings.rule.allDayAtMinutes}
            preview={(d, m) =>
              t(d > 0 ? "reminders.previewEventBefore" : "reminders.previewEventDay", { time: toField(m) })
            }
            testId="reminder-allday"
            onChange={(d, m) => saveRule({ allDayLeadDays: d, allDayAtMinutes: m })}
          />

          <SettingRow label={t("reminders.tasks")}>
            <Switch
              checked={settings.tasks}
              label={t("reminders.tasks")}
              onChange={(on) => void save({ ...settings, tasks: on }, remindTasksKey(vaultPath ?? ""), on)}
            />
          </SettingRow>

          {/* Directly under the switch it belongs to: on its own it would read
              like a second, unrelated task setting. */}
          {settings.tasks && (
            <DayTimeRow
              label={t("reminders.tasksNoTime")}
              days={[
                { value: 0, label: t("reminders.dayOfDue") },
                { value: 1, label: t("reminders.dayBeforeDue") },
              ]}
              day={settings.rule.taskLeadDays}
              minutes={settings.rule.taskAtMinutes}
              preview={(d, m) =>
                t(d > 0 ? "reminders.previewDueBefore" : "reminders.previewDueDay", { time: toField(m) })
              }
              testId="reminder-tasktime"
              onChange={(d, m) => saveRule({ taskLeadDays: d, taskAtMinutes: m })}
            />
          )}

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

          {diagnosis && (
            <SettingCardNote>
              {t("reminders.diagPlanned", diagnosis.planned)}
              {diagnosis.reasonKey ? ` ${t(diagnosis.reasonKey)}` : ""}
            </SettingCardNote>
          )}

          <SettingCardNote>{t("reminders.desktopWindow")}</SettingCardNote>
        </>
      )}
    </SettingCard>
  );
}
