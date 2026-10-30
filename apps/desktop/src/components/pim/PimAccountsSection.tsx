import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, RefreshCw } from "lucide-react";
import { AccountFailureNote, Banner, Button, EmptyState, ICON, MEETING_TEMPLATE_TOKENS, SettingCard, SettingCardActions, SettingCardBlock, SettingCardNote, SettingRow, TextInput, listTemplates, logDiagnostic, needsReauthorisation, pimAccountFailure, pimProviderName, reviewDuplicatePimRows, type CloudServiceId } from "@plainva/ui";
import type { PimAccountRow, PimCalendar, PimTaskList } from "@plainva/core";
import { useVault, meetingFolderKey, meetingNoteTemplateKey, templateFolderKey, DEFAULT_MEETING_FOLDER, defaultCalendarKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { Select } from "../Select";

/**
 * One diagnostics line per discovered collection (issue #34).
 *
 * Three rounds of this thread were spent guessing why a reporter's iCloud
 * reminder lists did not appear and where a ⚠️ in a list name came from — the
 * character exists nowhere in this repository, so it arrives from the server,
 * and nothing we could see told us which collections the server actually
 * reported. This makes ONE diagnostics export answer that: for each collection
 * its provider id (the CalDAV collection href), the name exactly as sent, and
 * how we classified it.
 *
 * No note content, no credentials — an export is something a user pastes into a
 * public issue. `logDiagnostic` redacts token-shaped strings on top of that.
 */
function logCollections(
  accounts: PimAccountRow[],
  calendars: (PimCalendar & { accountId: string })[],
  taskLists: (PimTaskList & { accountId: string })[]
): void {
  for (const a of accounts) {
    const cals = calendars.filter((c) => c.accountId === a.id);
    const lists = taskLists.filter((l) => l.accountId === a.id);
    logDiagnostic(
      "pim",
      `account ${a.provider} ${a.id}: ${cals.length} calendar(s), ${lists.length} task list(s)`
    );
    for (const c of cals) {
      logDiagnostic("pim", `  calendar id=${c.id} name=${JSON.stringify(c.name)} events=${c.supportsEvents !== false} tasks=${c.supportsTasks === true}`);
    }
    for (const l of lists) {
      logDiagnostic("pim", `  task list id=${l.id} name=${JSON.stringify(l.name)}`);
    }
  }
}

/**
 * Settings page "Calendar" (cloud-accounts split): the accounts with the way to
 * each one's calendars and lists, the default calendar and the meeting notes,
 * as three cards (settings plan 2026-10-29, B1/B2). Connecting and removing
 * accounts lives in the Cloud-Konten area (the connect wizard). Only rendered
 * for the OPEN vault (the runtime is bound to its index DB).
 */

export function PimAccountsSection({ onOpenCloudAccounts }: { onOpenCloudAccounts?: (accountRef?: string, service?: CloudServiceId) => void }) {
  const { t } = useTranslation();

  const { pimRuntime, vaultPath, vaultAdapter } = useVault();
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const duplicates = useMemo(() => reviewDuplicatePimRows(accounts), [accounts]);
  const [calendars, setCalendars] = useState<Array<PimCalendar & { accountId: string; selected: boolean }>>([]);
  const [taskLists, setTaskLists] = useState<Array<PimTaskList & { accountId: string; selected: boolean }>>([]);
  // Per-account failures. The worker has always RECORDED them in the scope
  // state; nothing ever showed them, so a failing account looked like an empty
  // one (issue #34 — the reporter mistook an emoji in a list name for our
  // error indicator, because we had none).
  const [errors, setErrors] = useState<Record<string, { account?: string; taskLists?: string }>>({});
  const [tick, setTick] = useState(0);
  /**
   * "Try again" ran the cycle and said nothing, so it looked like a dead button
   * (finding 2026-07-30). It now shows that it is working, and — when the very
   * same error comes back — says so, keyed by the error text: a different or
   * cleared error makes the note disappear on its own.
   */
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retriedError, setRetriedError] = useState<Record<string, string>>({});
  const retryAccount = async (accountId: string, before?: string) => {
    if (!pimRuntime) return;
    setRetrying(accountId);
    try {
      // Awaits the cycle unless one is already running (then it queues, and the
      // pim-changed event below refreshes us when it lands).
      await pimRuntime.worker.triggerImmediate();
      const state = await pimRuntime.cache.getScopeState(accountId, "account").catch(() => null);
      const after = state?.lastError ?? undefined;
      setRetriedError((m) => {
        const next = { ...m };
        if (after && after === before) next[accountId] = after;
        else delete next[accountId];
        return next;
      });
    } finally {
      setRetrying(null);
      setTick((x) => x + 1);
    }
  };
  const [meetingFolder, setMeetingFolder] = useState("");

  // Meetings folder ("Termin → Meeting-Notiz" target, stage 2c). Loaded once,
  // persisted on blur through the normal settings store.
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(meetingFolderKey(vaultPath))) ?? "";
      if (alive) setMeetingFolder(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistMeetingFolder = useCallback(async () => {
    if (!vaultPath) return;
    const store = await getSettingsStore();
    await store.set(meetingFolderKey(vaultPath), meetingFolder.trim());
    await store.save();
  }, [vaultPath, meetingFolder]);

  // Meeting-note template (plan Befunde 24.09., E24) — the daily note's
  // setting, for meetings: a pick from the templates folder, or a typed name
  // when the folder holds none. Loaded once like the folder above.
  const [meetingTemplate, setMeetingTemplate] = useState("");
  const [templateFiles, setTemplateFiles] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const value = (await store.get<string>(meetingNoteTemplateKey(vaultPath))) ?? "";
      const folder = (await store.get<string>(templateFolderKey(vaultPath))) || "Templates";
      const items = vaultAdapter ? await listTemplates(vaultAdapter, folder) : [];
      if (!alive) return;
      setMeetingTemplate(value);
      setTemplateFiles(items.map((it) => it.path.split("/").pop() ?? it.path));
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, vaultAdapter]);
  const persistMeetingTemplate = useCallback(
    async (value: string) => {
      if (!vaultPath) return;
      const store = await getSettingsStore();
      await store.set(meetingNoteTemplateKey(vaultPath), value.trim());
      await store.save();
    },
    [vaultPath]
  );

  // Default calendar for new events ("<accountId> <calId>"; "" = first writable).
  const [defaultCal, setDefaultCal] = useState("");
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(defaultCalendarKey(vaultPath))) ?? "";
      if (alive) setDefaultCal(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistDefaultCal = useCallback(
    async (value: string) => {
      setDefaultCal(value);
      if (!vaultPath) return;
      const store = await getSettingsStore();
      await store.set(defaultCalendarKey(vaultPath), value);
      await store.save();
      // Let an open calendar tab pick it up without a remount.
      window.dispatchEvent(new CustomEvent("plainva-default-calendar-changed"));
    },
    [vaultPath]
  );
  const defaultCalOptions = useMemo(() => {
    const accById = new Map(accounts.map((a) => [a.id, a.label]));
    const writable = calendars
      .filter((c) => !c.readOnly)
      .map((c) => ({ value: `${c.accountId} ${c.id}`, label: accounts.length > 1 ? `${c.name} · ${accById.get(c.accountId) ?? ""}` : c.name }));
    return [{ value: "", label: t("pim.defaultCalendarFirst", { defaultValue: "Erster beschreibbarer Kalender" }) }, ...writable];
  }, [calendars, accounts, t]);

  useEffect(() => {
    let alive = true;
    if (!pimRuntime) {
      setAccounts([]);
      setCalendars([]);
      setTaskLists([]);
      setErrors({});
      return;
    }
    void (async () => {
      try {
        const [acc, cals, lists] = await Promise.all([
          pimRuntime.cache.listAccounts(),
          pimRuntime.cache.listCalendars(),
          pimRuntime.cache.listTaskLists(),
        ]);
        if (!alive) return;
        setAccounts(acc);
        setCalendars(cals);
        setTaskLists(lists);
        logCollections(acc, cals, lists);
        const states = await Promise.all(
          acc.map(async (a) => {
            const [account, tasks] = await Promise.all([
              pimRuntime.cache.getScopeState(a.id, "account").catch(() => null),
              pimRuntime.cache.getScopeState(a.id, "tasklists").catch(() => null),
            ]);
            return [a.id, { account: account?.lastError ?? undefined, taskLists: tasks?.lastError ?? undefined }] as const;
          })
        );
        if (!alive) return;
        setErrors(Object.fromEntries(states));
      } catch (e) {
        console.error("[PimAccountsSection] loading accounts failed", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pimRuntime, tick]);

  // Fresh pull results (worker cycle) refresh the lists too.
  useEffect(() => {
    const onChanged = () => setTick((x) => x + 1);
    window.addEventListener("plainva-pim-changed", onChanged);
    return () => window.removeEventListener("plainva-pim-changed", onChanged);
  }, []);

  if (!pimRuntime) {
    return (
      <SettingCard>
        <SettingCardNote>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</SettingCardNote>
      </SettingCard>
    );
  }

  const providerLabel = (p: string) => pimProviderName(p, t);

  /** What the meeting template may use — behind its info, with the guide (3.4 A). */
  const meetingTemplateInfo = [t("pim.meetingTemplateHint"), `${t("pim.meetingTemplatePlaceholders")} ${MEETING_TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(" ")}`].join("\n\n");

  /* The page in the order of the plan (settings plan 2026-10-29, B1): the
     accounts first, then what they feed — the default calendar, the meeting
     notes — and the reminders last. Every group is a card of rows (B2): the
     account blocks drew their own frames inside one card before. */
  return (
    <>
      <SettingCard label={t("pim.groupAccounts")} testId="pim-accounts">
        {accounts.length === 0 && (
          <EmptyState title={t("pim.noAccounts", { defaultValue: "Noch keine Kalender-Konten verbunden." })} icon={<CalendarDays size={ICON.empty} />}>
            {onOpenCloudAccounts && (
              <Button variant="primary" onClick={() => onOpenCloudAccounts(undefined, "calendar")} data-testid="pim-open-cloudaccounts">
                {t("cloudAccounts.openArea")}
              </Button>
            )}
          </EmptyState>
        )}

        {/* Duplicated rows are named, never folded automatically: a calendar row
            carries the selection, the cached events and every mirrored task's
            anchor. Same rule and same two stages as the phone. */}
        {duplicates.map((need) => (
          <SettingCardBlock key={need.accountIds.join(",")}>
            <Banner kind="warning">
              {t(need.reason === "same-identity" ? "pim.duplicateSameIdentity" : "pim.duplicateSameLabel", {
                label: need.label,
                n: need.accountIds.length,
              })}
            </Banner>
          </SettingCardBlock>
        ))}

        {accounts.map((account) => {
          const accErrors = errors[account.id] ?? {};
          return (
            <React.Fragment key={account.id}>
              <SettingRow
                label={account.label}
                desc={`${providerLabel(account.provider)} · ${t("cloudAccounts.calendarSummary", {
                  calendars: calendars.filter((c) => c.accountId === account.id && c.selected).length,
                  lists: taskLists.filter((l) => l.accountId === account.id && l.selected).length,
                })}`}
              >
                {/* The calendars and lists of ONE account, its switch and its colours
                    live on that account's calendar page (plan "Verbinden", V3); this
                    page keeps what every account shares (E4). */}
                <span data-testid={`pim-account-${account.provider}`} style={{ display: "contents" }}>
                  {onOpenCloudAccounts && (
                    <Button variant="ghost" size="sm" onClick={() => onOpenCloudAccounts(account.id, "calendar")} data-testid={`pim-account-settings-${account.id}`}>
                      {t("cloudAccounts.openAccountCalendar")} ›
                    </Button>
                  )}
                </span>
              </SettingRow>
              {accErrors.account && (
                <SettingCardBlock>
                  {/* What the failure means in the person's terms, who failed, and the
                      provider's own words small under it — "400 Bad Request" answered
                      nothing as a headline (finding 2026-10-30: the same parts as the phone). */}
                  <AccountFailureNote
                    failure={pimAccountFailure(accErrors.account, account.provider, t)}
                    name={account.label}
                    testId={`pim-account-error-${account.id}`}
                    actions={
                      <>
                        {/* An expired grant cannot be retried into working. The
                            primary action has to be the one that helps. */}
                        {needsReauthorisation(accErrors.account) && onOpenCloudAccounts && (
                          <Button variant="secondary" size="sm" onClick={() => onOpenCloudAccounts(account.id)} data-testid="pim-reauthorise">
                            {t("cloudAccounts.reconnect")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={retrying === account.id}
                          onClick={() => void retryAccount(account.id, accErrors.account)}
                          data-testid={`pim-retry-${account.id}`}
                        >
                          {retrying === account.id ? t("pim.retrying") : t("pim.tryAgain")}
                        </Button>
                      </>
                    }
                  />
                  {retriedError[account.id] === accErrors.account && (
                    <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }} data-testid={`pim-retry-same-${account.id}`}>
                      {t("pim.retrySameError")}
                    </p>
                  )}
                  <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                    {t("pim.lastKnownSelection")}
                  </p>
                </SettingCardBlock>
              )}
            </React.Fragment>
          );
        })}

        {accounts.length > 0 && (
          <SettingCardActions>
            <Button variant="ghost" onClick={() => void pimRuntime.worker.triggerImmediate()}>
              <RefreshCw size={ICON.ui} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              {t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })}
            </Button>
          </SettingCardActions>
        )}
      </SettingCard>

      {/* The one place for the default calendar (E13): an account's calendar
          page only shows which calendar is the default. */}
      {defaultCalOptions.length > 1 && (
        <SettingCard label={t("pim.groupEvents")}>
          <SettingRow label={t("pim.defaultCalendar", { defaultValue: "Standardkalender für Termine" })}>
            <Select
              ariaLabel={t("pim.defaultCalendar", { defaultValue: "Standardkalender für Termine" })}
              value={defaultCal}
              onChange={(v) => void persistDefaultCal(v)}
              options={defaultCalOptions}
              data-testid="pim-default-calendar"
            />
          </SettingRow>
        </SettingCard>
      )}

      {/* Meeting notes stay with the calendar: "Event → meeting note" starts
          there (B1, move 32). */}
      <SettingCard label={t("pim.groupMeetingNotes")}>
        <SettingRow label={t("pim.meetingFolder", { defaultValue: "Meeting-Ordner" })} info={t("pim.meetingFolderHint")}>
          <TextInput
            autoComplete="off"
            value={meetingFolder}
            onChange={(e) => setMeetingFolder(e.target.value)}
            onBlur={() => void persistMeetingFolder()}
            placeholder={DEFAULT_MEETING_FOLDER}
            data-testid="pim-meeting-folder"
          />
        </SettingRow>
        <SettingRow label={t("pim.meetingTemplate")} info={{ text: meetingTemplateInfo, guide: "Calendar_and_Tasks.md" }}>
          <span data-testid="pim-meeting-template-row" style={{ display: "contents" }}>
            {templateFiles.length > 0 ? (
              <Select
                ariaLabel={t("pim.meetingTemplate")}
                value={meetingTemplate}
                onChange={(v) => {
                  setMeetingTemplate(v);
                  void persistMeetingTemplate(v);
                }}
                // A typed path that is not in the folder stays visible instead of
                // turning into "—" behind the person's back.
                options={[
                  { value: "", label: "—" },
                  ...(meetingTemplate && !templateFiles.includes(meetingTemplate) ? [{ value: meetingTemplate, label: meetingTemplate }] : []),
                  ...templateFiles.map((f) => ({ value: f, label: f.replace(/\.md$/i, "") })),
                ]}
                data-testid="pim-meeting-template"
              />
            ) : (
              <TextInput
                autoComplete="off"
                value={meetingTemplate}
                onChange={(e) => setMeetingTemplate(e.target.value)}
                onBlur={() => void persistMeetingTemplate(meetingTemplate)}
                placeholder="Meeting.md"
                data-testid="pim-meeting-template"
              />
            )}
          </span>
        </SettingRow>
      </SettingCard>
    </>
  );
}
