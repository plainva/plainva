import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  Banner,
  Button,
  DriveDestinationDialog,
  EVENT_COLOR_PALETTE,
  ICON,
  IconButton,
  SettingCard,
  SettingCardBlock,
  SettingCardNote,
  SettingRow,
  SwatchGrid,
  Switch,
  TextInput,
  calendarColor,
  calendarPickerOptions,
  emptyTaskListHintKey,
  familyLabel,
  taskListState,
  serviceLabel,
  toast,
  type CalendarColorOverrides,
  type CloudAccountRecord,
  type CloudServiceId,
} from "@plainva/ui";
import { listMailAccounts, listMailboxesFor, type MailAccountConfig } from "@plainva/ui/mail";
import type { PimCalendar } from "@plainva/core";
import { MIN_SYNC_INTERVAL_SECONDS, defaultCalendarKey, defaultSyncIntervalSeconds, syncIntervalKey } from "../../contexts/VaultContext";
import { syncStatusStore } from "../../services/syncStatusStore";
import { getSettingsStore } from "../../services/settingsStore";
import { announceCredentials, createSyncFolderFromSlots, getSyncRootFolder, listSyncFoldersFromSlots, openDriveDestination, saveSyncRootFolder } from "../../services/cloudAccountsActions";
import { isSyncPausedHere, setSyncPausedHere } from "../../services/filesSwitch";
import { loadCalendarColors, saveCalendarColor } from "../../services/pim/calendarColors";
import type { PimRuntime } from "../../services/pim/pimRuntime";
import { SyncFolderPickerModal } from "../SyncFolderPickerModal";
import { MailSendingCard } from "../mail/MailSendingCard";
import { Select } from "../Select";
import { AccountMark } from "./cloudAccountsShared";

/**
 * One service of ONE account (plan "Verbinden", V3 - level 3): only what
 * belongs to this account. The switch in the head is the same as on the
 * account page (E3: for the vault). What holds for every account - reminders,
 * the meeting folder, mail rules, out-of-office, the sync of settings - stays
 * on the Calendar, E-Mail and Sync pages, and this page links there (E4).
 */
export const AccountServicePage: React.FC<{
  vaultPath: string;
  record: CloudAccountRecord;
  service: CloudServiceId;
  on: boolean;
  busy: boolean;
  isActiveVault: boolean;
  runtime: PimRuntime | null;
  onToggle: (on: boolean) => void;
  onBack: () => void;
  /** Opens a settings page of the vault ("sync", "pim", "mail"). */
  onOpenArea: (area: "sync" | "pim" | "mail") => void;
}> = (p) => {
  const { t } = useTranslation();
  const area = p.service === "files" ? "sync" : p.service === "calendar" ? "pim" : "mail";
  return (
    <div data-testid={`account-service-${p.service}`}>
      <div className="pv-acct-head">
        <IconButton label={t("cloudAccounts.back")} onClick={p.onBack} data-testid="account-service-back">
          <ArrowLeft size={ICON.ui} />
        </IconButton>
        <AccountMark family={p.record.family} flavor={p.record.flavor} />
        <div className="pv-acct-who">
          <div className="pv-acct-name">{serviceLabel(p.service)}</div>
          <div className="pv-acct-id">{`${familyLabel(p.record.family, p.record.flavor)} · ${p.record.label}`}</div>
        </div>
        <Switch checked={p.on} disabled={p.busy || !p.isActiveVault} label={serviceLabel(p.service)} onChange={p.onToggle} testId="account-service-switch" />
      </div>
      {!p.on && <SettingCardNote>{t("cloudAccounts.serviceOffHint")}</SettingCardNote>}
      {p.service === "files" && p.record.services.files && <FilesPart vaultPath={p.vaultPath} record={p.record} on={p.on} />}
      {p.service === "calendar" && p.record.services.calendar && <CalendarPart vaultPath={p.vaultPath} pimAccountId={p.record.services.calendar.pimAccountId} runtime={p.runtime} />}
      {p.service === "mail" && p.record.services.mail && <MailPart vaultPath={p.vaultPath} mailAccountId={p.record.services.mail.mailAccountId} />}
      <SettingCardNote>
        {t(area === "sync" ? "cloudAccounts.allAccountsSync" : area === "pim" ? "cloudAccounts.allAccountsCalendar" : "cloudAccounts.allAccountsMail")}{" "}
        <Button variant="ghost" size="sm" onClick={() => p.onOpenArea(area)} data-testid="account-service-global">
          {t(area === "sync" ? "cloudAccounts.openSyncSettings" : area === "pim" ? "cloudAccounts.openCalendarSettings" : "cloudAccounts.openMailSettings")}
        </Button>
      </SettingCardNote>
    </div>
  );
};

/* ---------- files ---------- */

/** The vault's sync interval, saved once the typing stops and on leaving the page. */
function useSyncInterval(vaultPath: string) {
  const [value, setValue] = useState(String(defaultSyncIntervalSeconds()));
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    void getSettingsStore().then(async (store) => {
      // Per vault, falling back to the legacy global value, then the default.
      const stored = await store.get<number>(syncIntervalKey(vaultPath)) ?? await store.get<number>("syncIntervalSeconds");
      if (alive) setValue(String(stored ?? defaultSyncIntervalSeconds()));
    });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      pending.current?.();
    };
  }, [vaultPath]);
  const change = (raw: string) => {
    setValue(raw);
    const run = () => {
      pending.current = null;
      timer.current = null;
      const parsed = parseInt(raw, 10);
      const seconds = Number.isFinite(parsed) ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsed) : defaultSyncIntervalSeconds();
      void getSettingsStore().then(async (store) => {
        await store.set(syncIntervalKey(vaultPath), seconds);
        await store.save();
        // Reloading the vault restarts its worker with the new interval.
        announceCredentials(false);
      });
    };
    if (timer.current) clearTimeout(timer.current);
    pending.current = run;
    timer.current = setTimeout(run, 800);
  };
  const normalize = () => {
    const parsed = parseInt(value, 10);
    setValue(String(Number.isFinite(parsed) ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsed) : defaultSyncIntervalSeconds()));
  };
  return { value, change, normalize };
}

function FilesPart({ vaultPath, record, on }: { vaultPath: string; record: CloudAccountRecord; on: boolean }) {
  const { t } = useTranslation();
  const provider = record.services.files!.provider;
  const [rootFolder, setRootFolder] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [drivePicker, setDrivePicker] = useState<Awaited<ReturnType<typeof openDriveDestination>> | null>(null);
  const [opening, setOpening] = useState(false);
  const [paused, setPaused] = useState(false);
  const interval = useSyncInterval(vaultPath);
  const status = useSyncExternalStore(syncStatusStore.subscribe, () => syncStatusStore.get(vaultPath));

  const reload = useCallback(async () => {
    setRootFolder(await getSyncRootFolder(vaultPath, provider).catch(() => ""));
    setPaused(await isSyncPausedHere(vaultPath));
  }, [vaultPath, provider]);
  useEffect(() => { void reload(); }, [reload]);

  const togglePause = async (next: boolean) => {
    setPaused(next);
    await setSyncPausedHere(vaultPath, next);
    // The vault opens again with or without its sync target.
    announceCredentials(false);
  };

  const state = !on ? t("cloudAccounts.syncStateOff")
    : paused ? t("cloudAccounts.syncStatePaused")
      : status.status === "syncing" ? t("cloudAccounts.syncStateSyncing")
        : status.status === "error" || status.status === "retrying" ? t("cloudAccounts.syncStateError", { message: status.message ?? "" })
          : t("cloudAccounts.syncStateIdle");

  return (
    <>
      <SettingCard label={t("cloudAccounts.filesGroup")}>
        <SettingRow label={t("cloudAccounts.cloudFolder")} desc={t("cloudAccounts.cloudFolderHint")}>
          <TextInput value={rootFolder} readOnly style={{ width: 180 }} data-testid="account-files-folder" />
          {provider !== "webdav" && (
            <Button variant="secondary" disabled={opening} onClick={() => {
              if (provider !== "drive") { setShowPicker(true); return; }
              setOpening(true);
              void openDriveDestination(vaultPath).then(setDrivePicker).catch((error) => toast.warning(String(error))).finally(() => setOpening(false));
            }}>
              {t("settings.browseFolders")}
            </Button>
          )}
        </SettingRow>
        <SettingRow label={t("settings.syncInterval")} desc={t("settings.syncIntervalDesc", { min: MIN_SYNC_INTERVAL_SECONDS })}>
          <TextInput
            type="number"
            min={MIN_SYNC_INTERVAL_SECONDS}
            value={interval.value}
            onChange={(e) => interval.change(e.target.value)}
            onBlur={interval.normalize}
            style={{ flex: 1, minWidth: 0 }}
            data-testid="account-files-interval"
          />
        </SettingRow>
        <SettingRow label={t("cloudAccounts.syncState")} desc={state}>{null}</SettingRow>
        <SettingRow label={t("cloudAccounts.pauseSync")} desc={t("cloudAccounts.pauseSyncHint")}>
          <Switch checked={paused} disabled={!on} label={t("cloudAccounts.pauseSync")} onChange={(next) => void togglePause(next)} testId="account-files-pause" />
        </SettingRow>
        {/* What "off" means for the other devices, said where it is switched (review finding 4). */}
        <SettingCardNote><span data-testid="account-files-limit">{t("cloudAccounts.filesOffLimit")}</span></SettingCardNote>
      </SettingCard>
      {drivePicker && <DriveDestinationDialog session={drivePicker} onClose={() => setDrivePicker(null)}
        onSave={async (selected) => { await saveSyncRootFolder(drivePicker.vaultPath, "drive", selected.path, selected.id); await reload(); }} />}
      {showPicker && provider !== "webdav" && (
        <SyncFolderPickerModal
          listFolders={(path) => listSyncFoldersFromSlots(vaultPath, provider, path)}
          createFolder={(path) => createSyncFolderFromSlots(vaultPath, provider, path)}
          rootLabel={record.label || provider}
          allowRoot={provider === "s3"}
          onSelect={(picked) => {
            setShowPicker(false);
            void saveSyncRootFolder(vaultPath, provider, picked).then(() => reload());
          }}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

/* ---------- calendar & tasks ---------- */

type CalendarRow = PimCalendar & { accountId: string; selected: boolean };

function CalendarPart({ vaultPath, pimAccountId, runtime }: { vaultPath: string; pimAccountId: string; runtime: PimRuntime | null }) {
  const { t } = useTranslation();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [lists, setLists] = useState<{ id: string; name: string; selected: boolean }[]>([]);
  const [colors, setColors] = useState<CalendarColorOverrides>({});
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [defaultCalendar, setDefaultCalendar] = useState("");
  /** What the last cycle said about this account and its lists, and its provider (for the empty-list hint). */
  const [scope, setScope] = useState<{ account?: string; lists?: string; provider: string }>({ provider: "" });

  const reload = useCallback(async () => {
    if (!runtime?.isActive()) return;
    setCalendars(await runtime.cache.listCalendars(pimAccountId).catch(() => []));
    setLists(await runtime.cache.listTaskLists(pimAccountId).catch(() => []));
    const [account, tasks, rows] = await Promise.all([
      runtime.cache.getScopeState(pimAccountId, "account").catch(() => null),
      runtime.cache.getScopeState(pimAccountId, "tasklists").catch(() => null),
      runtime.cache.listAccounts().catch(() => []),
    ]);
    setScope({ account: account?.lastError ?? undefined, lists: tasks?.lastError ?? undefined, provider: rows.find((row) => row.id === pimAccountId)?.provider ?? "" });
    setColors(await loadCalendarColors(vaultPath));
    setDefaultCalendar((await (await getSettingsStore()).get<string>(defaultCalendarKey(vaultPath))) ?? "");
  }, [runtime, pimAccountId, vaultPath]);
  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener("plainva-pim-changed", onChanged);
    return () => window.removeEventListener("plainva-pim-changed", onChanged);
  }, [reload]);

  if (!runtime) return <SettingCardNote>{t("pim.openVaultFirst")}</SettingCardNote>;

  const toggleCalendar = async (calendar: CalendarRow, selected: boolean) => {
    await runtime.cache.setCalendarSelected(pimAccountId, calendar.id, selected);
    void runtime.worker.triggerImmediate();
    await reload();
  };
  const toggleList = async (listId: string, selected: boolean) => {
    await runtime.cache.setTaskListSelected(pimAccountId, listId, selected);
    void runtime.worker.triggerImmediate();
    await reload();
  };
  const pickColor = async (calendar: CalendarRow, color: string) => {
    setColors(await saveCalendarColor(vaultPath, pimAccountId, calendar.id, color));
  };
  const pickDefault = async (value: string) => {
    setDefaultCalendar(value);
    const store = await getSettingsStore();
    await store.set(defaultCalendarKey(vaultPath), value);
    await store.save();
    window.dispatchEvent(new CustomEvent("plainva-default-calendar-changed"));
  };
  const writable = calendars.filter((calendar) => !calendar.readOnly && calendar.supportsEvents !== false);
  const listState = taskListState({ count: lists.length, listsError: scope.lists, accountError: scope.account });
  const lookAgain = () => { void runtime.worker.triggerImmediate().then(() => reload()); };
  const options = calendarPickerOptions(writable, new Map(), false);

  return (
    <>
      <SettingCard label={t("pim.calendars")}>
        {calendars.length === 0 && <SettingCardNote>{t("cloudAccounts.noCalendarsYet")}</SettingCardNote>}
        {calendars.map((calendar) => {
          const color = calendarColor(calendar, colors);
          return (
            <React.Fragment key={calendar.id}>
              <SettingRow label={calendar.name} desc={calendar.readOnly ? t("cloudAccounts.readOnlyCalendar") : undefined}>
                <IconButton label={t("cloudAccounts.calendarColor", { name: calendar.name })} onClick={() => setColorFor(colorFor === calendar.id ? null : calendar.id)} data-testid={`account-calendar-color-${calendar.id}`}>
                  <span className="pv-dot" style={{ color: color || "var(--accent-color)" }} />
                </IconButton>
                <Switch checked={calendar.selected} label={calendar.name} onChange={(next) => void toggleCalendar(calendar, next)} testId={`account-calendar-${calendar.id}`} />
              </SettingRow>
              {colorFor === calendar.id && (
                <SettingCardBlock>
                  <SwatchGrid
                    ariaLabel={t("cloudAccounts.calendarColor", { name: calendar.name })}
                    presets={EVENT_COLOR_PALETTE}
                    value={colors[`${pimAccountId} ${calendar.id}`] ?? ""}
                    onPick={(hex) => void pickColor(calendar, hex)}
                    none={{ label: t("cloudAccounts.providerColor"), active: !colors[`${pimAccountId} ${calendar.id}`], onPick: () => void pickColor(calendar, ""), glyph: "slash" }}
                    testIdPrefix={`account-calendar-swatch-${calendar.id}-`}
                  />
                </SettingCardBlock>
              )}
            </React.Fragment>
          );
        })}
        {options.length > 0 && (
          <SettingRow label={t("pim.defaultCalendar")} desc={t("cloudAccounts.defaultCalendarHint")}>
            <Select
              value={options.some((option) => option.value === defaultCalendar) ? defaultCalendar : ""}
              onChange={(value) => void pickDefault(value)}
              ariaLabel={t("pim.defaultCalendar")}
              data-testid="account-calendar-default"
              options={[{ value: "", label: t("cloudAccounts.defaultElsewhere") }, ...options]}
            />
          </SettingRow>
        )}
      </SettingCard>
      {scope.provider !== "device" || lists.length > 0 ? (
        <SettingCard label={t("pim.taskLists")}>
          {listState === "failed" && (
            <SettingCardBlock>
              <Banner kind="error" rounded actions={<Button variant="ghost" size="sm" onClick={lookAgain}>{t("pim.lookAgain")}</Button>}>
                {t("pim.taskListsFailed")} {scope.lists}
              </Banner>
            </SettingCardBlock>
          )}
          {listState === "unknown" && <SettingCardNote><span data-testid="pim-tasklists-unknown">{t("pim.taskListsUnknown")}</span></SettingCardNote>}
          {listState === "empty" && (
            <SettingCardNote>
              <span data-testid="pim-tasklists-empty">{t("pim.noTaskLists")} {t(emptyTaskListHintKey(scope.provider))}</span>{" "}
              <Button variant="ghost" size="sm" onClick={lookAgain}>{t("pim.lookAgain")}</Button>
            </SettingCardNote>
          )}
          {lists.map((list) => (
            <SettingRow key={list.id} label={list.name}>
              <Switch checked={list.selected} label={list.name} onChange={(next) => void toggleList(list.id, next)} testId={`account-tasklist-${list.id}`} />
            </SettingRow>
          ))}
        </SettingCard>
      ) : null}
      <Button variant="secondary" icon={<RefreshCw size={ICON.meta} />} onClick={() => void runtime.worker.triggerImmediate()} data-testid="account-calendar-sync">
        {t("cloudAccounts.syncNow")}
      </Button>
    </>
  );
}

/* ---------- mail ---------- */

function MailPart({ vaultPath, mailAccountId }: { vaultPath: string; mailAccountId: string }) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<MailAccountConfig | null>(null);
  const [folders, setFolders] = useState<string[] | null>(null);
  const reload = useCallback(async () => {
    setAccount((await listMailAccounts(vaultPath)).find((entry) => entry.id === mailAccountId) ?? null);
  }, [vaultPath, mailAccountId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    void listMailboxesFor(vaultPath, account)
      .then((boxes) => { if (alive) setFolders(boxes.map((box) => box.name)); })
      .catch(() => { if (alive) setFolders([]); });
    return () => { alive = false; };
  }, [vaultPath, account]);
  if (!account) return null;
  return (
    <>
      <SettingCard label={t("cloudAccounts.mailFolders")}>
        {folders === null && <SettingCardNote>{t("cloudAccounts.checkRunning")}</SettingCardNote>}
        {folders?.length === 0 && <SettingCardNote>{t("cloudAccounts.mailFoldersUnavailable")}</SettingCardNote>}
        {folders && folders.length > 0 && (
          <SettingCardNote>
            <span data-testid="account-mail-folders">{folders.join(" · ")}</span>
          </SettingCardNote>
        )}
      </SettingCard>
      <MailSendingCard vaultPath={vaultPath} account={account} onChanged={() => void reload()} />
    </>
  );
}
