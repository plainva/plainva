import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Activity, CalendarDays, ChevronRight, Cloud, ListChecks, Mail, Pause, RefreshCw } from "lucide-react";
import {
  accountPageModel,
  Banner,
  Button,
  calendarColor,
  emptyTaskListHintKey,
  taskListState,
  calendarPickerOptions,
  DriveDestinationDialog,
  familyLabel,
  GroupCard,
  ICON,
  Row,
  RowList,
  SectionLabel,
  serviceLabel,
  SettingField,
  Switch,
  TextArea,
  toast,
  withCalendarColor,
  type CloudServiceId,
} from "@plainva/ui";
import { listMailAccounts, listMailboxesFor, normalizeSenderAddress, senderOptions, updateMailAccount, type MailAccountConfig } from "@plainva/ui/mail";
import type { PimCalendar } from "@plainva/core";
import { AppBar } from "../components/AppBar";
import { CloudFolderPickerSheet } from "../components/CloudFolderPickerSheet";
import { ColorPickSheet } from "../components/ColorPickSheet";
import { syncStateLabel } from "../components/syncSubtitle";
import { loadAccountCards, type AccountCard } from "../services/cloudAccountCards";
import { setMobileServiceOff } from "../services/accountPageFacts";
import { mSelect } from "../services/mobileDialogs";
import { getMobileSettings, applyVaultSettings, updateMobileSettings } from "../services/mobileSettings";
import { MIN_SYNC_INTERVAL_SECONDS } from "../services/mobileSettingsScope";
import {
  changeRemoteFolder,
  createProviderFolder,
  getStoredProvider,
  getSyncStatus,
  listProviderFolders,
  openDriveDestination,
  pauseSyncHere,
  restartSync,
  resumeSyncHere,
  subscribeSyncStatus,
  type MobileSyncProvider,
} from "../services/syncService";
import { readSyncRootFolder } from "../services/syncRootFolder";
import { getVaultEntry } from "../services/vaultRegistry";
import { listPimAccounts, listPimCalendars, listPimTaskLists, pimSyncNow, setPimCalendarSelected, setPimTaskListSelected } from "../services/pim/pimService";
import { getPimCache } from "../services/pim/pimRuntime";
import { MAIL_CHANGED_EVENT, mailVaultId } from "../services/mail/mailRuntime";
import type { MobileVault } from "../services/vaultService";

/**
 * One service of ONE account (plan "Verbinden", V3 - level 3), the phone's
 * twin of the desktop's account service page: only what belongs to this
 * account. The switch in the head is the same as on the account page (E3: for
 * the vault). Cross-account settings stay on the Calendar, E-Mail and vault
 * pages, which this screen links to (E4).
 */
export function AccountServiceScreen({
  accountKey,
  service,
  vault,
  onBack,
  onOpenGlobal,
}: {
  accountKey: string;
  service: CloudServiceId;
  vault: MobileVault;
  onBack: () => void;
  /** The page of the settings that holds what is shared by every account. */
  onOpenGlobal: (service: CloudServiceId) => void;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<AccountCard | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    // The card by its key - or by the calendar or mailbox it carries, for the way in from the Calendar and E-Mail pages.
    void loadAccountCards()
      .then(({ cards }) => setCard(cards.find((entry) => entry.key === accountKey || entry.pimAccountId === accountKey || entry.mailAccountId === accountKey) ?? null))
      .catch(() => setCard(null));
  }, [accountKey]);
  useEffect(() => {
    reload();
    window.addEventListener("m-pim-changed", reload);
    window.addEventListener("m-vaults-changed", reload);
    return () => {
      window.removeEventListener("m-pim-changed", reload);
      window.removeEventListener("m-vaults-changed", reload);
    };
  }, [reload]);

  const row = card ? accountPageModel({ family: card.family, services: card.services, off: card.record?.off, signIn: card.signIn, canSignIn: false, signedInHere: false }).services.find((entry) => entry.service === service) : undefined;
  const toggle = (on: boolean) => {
    if (!card?.recordVaultId) return;
    setBusy(true);
    void setMobileServiceOff(card.recordVaultId, card, service, !on).then(reload).catch((e) => toast.error(String(e))).finally(() => setBusy(false));
  };
  const Icon = service === "files" ? Cloud : service === "calendar" ? CalendarDays : Mail;

  return (
    <div className="m-page" data-testid={`account-service-${service}`}>
      <AppBar onBack={onBack} title={serviceLabel(service)} />
      <div className="m-settings">
        {card && (
          <GroupCard>
            <RowList>
              <Row
                icon={<Icon size={ICON.ui} />}
                title={serviceLabel(service)}
                subtitle={`${familyLabel(card.family)} · ${card.label}`}
                wrap
                controls
                end={<Switch checked={!!row?.on} disabled={busy} label={serviceLabel(service)} onChange={toggle} testId="account-service-switch" />}
              />
            </RowList>
          </GroupCard>
        )}
        {card && !row?.on && <p className="m-hint">{t("cloudAccounts.serviceOffHint")}</p>}
        {card && service === "files" && card.vaultId && <FilesPart vaultId={card.vaultId} vault={vault} on={!!row?.on} />}
        {card && service === "calendar" && card.pimAccountId && <CalendarPart pimAccountId={card.pimAccountId} />}
        {card && service === "mail" && card.mailAccountId && <MailPart mailAccountId={card.mailAccountId} />}
        <GroupCard>
          <RowList>
            <Row
              data-testid="account-service-global"
              icon={<Activity size={ICON.ui} />}
              title={t(service === "files" ? "cloudAccounts.openSyncSettings" : service === "calendar" ? "cloudAccounts.openCalendarSettings" : "cloudAccounts.openMailSettings")}
              subtitle={t(service === "files" ? "cloudAccounts.allAccountsSync" : service === "calendar" ? "cloudAccounts.allAccountsCalendar" : "cloudAccounts.allAccountsMail")}
              wrap
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={() => onOpenGlobal(service)}
            />
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}

/* ---------- files ---------- */

function FilesPart({ vaultId, vault, on }: { vaultId: string; vault: MobileVault; on: boolean }) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [folder, setFolder] = useState("");
  const [paused, setPaused] = useState(false);
  const [interval, setIntervalSeconds] = useState(() => getMobileSettings().syncIntervalSeconds);
  const [folderPick, setFolderPick] = useState<MobileSyncProvider | null>(null);
  const [drivePicker, setDrivePicker] = useState<Awaited<ReturnType<typeof openDriveDestination>> | null>(null);
  const [busy, setBusy] = useState(false);
  const active = vault.vaultId === vaultId;
  const reload = useCallback(async () => {
    const stored = await getStoredProvider(vaultId).catch(() => null);
    setFolder(stored ? await readSyncRootFolder(vaultId, stored.provider, stored).catch(() => "") : "");
    const entry = await getVaultEntry(vaultId);
    setPaused(!!entry?.pausedHere);
  }, [vaultId]);
  useEffect(() => { void reload(); }, [reload]);

  const togglePause = (next: boolean) => {
    setBusy(true);
    // The person's own pause (review finding 5b); resuming also clears one an earlier version kept under the app's flag.
    void (next ? pauseSyncHere(vaultId) : resumeSyncHere(vaultId)).then(reload).finally(() => setBusy(false));
  };
  const pickInterval = () => {
    void mSelect({
      title: t("settings.syncInterval"),
      options: [15, 30, 60, 300, 900].map((seconds) => ({ value: String(seconds), label: t("mobile.syncIntervalValue", { seconds }) })),
      value: String(interval),
    }).then(async (picked) => {
      if (picked === null) return;
      const seconds = Math.max(MIN_SYNC_INTERVAL_SECONDS, Number(picked));
      await applyVaultSettings(vaultId, { syncIntervalSeconds: seconds });
      setIntervalSeconds(seconds);
      if (active) await restartSync(vault);
    });
  };
  const pickFolder = () => {
    setBusy(true);
    void getStoredProvider(vaultId)
      .then(async (stored) => {
        if (!stored || stored.provider === "webdav") return;
        if (stored.provider === "drive") { setDrivePicker(await openDriveDestination(vaultId)); return; }
        setFolderPick(stored);
      })
      .catch((error) => toast.warning(String(error)))
      .finally(() => setBusy(false));
  };
  const state = !on ? t("cloudAccounts.syncStateOff") : paused ? t("cloudAccounts.syncStatePaused") : active ? syncStateLabel(status, t) : t("cloudAccounts.syncStateIdle");

  return (
    <>
      <SectionLabel>{t("cloudAccounts.filesGroup")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            data-testid="account-files-folder"
            icon={<Cloud size={ICON.ui} />}
            title={t("cloudAccounts.cloudFolder")}
            subtitle={folder || t("cloudAccounts.cloudFolderHint")}
            wrap
            disabled={busy || !active}
            end={<ChevronRight className="m-chevron" size={ICON.ui} />}
            onClick={active ? pickFolder : undefined}
          />
          <Row
            data-testid="account-files-interval"
            icon={<RefreshCw size={ICON.ui} />}
            title={t("settings.syncInterval")}
            subtitle={t("mobile.syncIntervalValue", { seconds: interval })}
            end={<ChevronRight className="m-chevron" size={ICON.ui} />}
            onClick={pickInterval}
          />
          <Row icon={<Activity size={ICON.ui} />} title={t("cloudAccounts.syncState")} subtitle={state} wrap />
          <Row
            icon={<Pause size={ICON.ui} />}
            title={t("cloudAccounts.pauseSync")}
            subtitle={t("cloudAccounts.pauseSyncHint")}
            wrap
            controls
            end={<Switch checked={paused} disabled={busy || !on} label={t("cloudAccounts.pauseSync")} onChange={togglePause} testId="account-files-pause" />}
          />
        </RowList>
      </GroupCard>
      {/* What "off" means for the other devices, said where it is switched (review finding 4). */}
      <p className="m-hint" data-testid="account-files-limit">{t("cloudAccounts.filesOffLimit")}</p>
      {drivePicker && <DriveDestinationDialog session={drivePicker} onClose={() => setDrivePicker(null)}
        onSave={async (selected) => { await changeRemoteFolder(vault, selected.path, selected.id); await reload(); }} />}
      {folderPick && (
        <CloudFolderPickerSheet
          title={t("mobile.changeCloudFolder")}
          listFolders={(path) => listProviderFolders(folderPick, path)}
          createFolder={(path) => createProviderFolder(folderPick, path)}
          onClose={() => setFolderPick(null)}
          onPick={(path) => {
            setFolderPick(null);
            void changeRemoteFolder(vault, path).then(reload).catch((e) => toast.warning(String(e)));
          }}
        />
      )}
    </>
  );
}

/* ---------- calendar & tasks ---------- */

type CalendarRow = PimCalendar & { accountId: string; selected: boolean };

function CalendarPart({ pimAccountId }: { pimAccountId: string }) {
  const { t } = useTranslation();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [lists, setLists] = useState<{ id: string; name: string; accountId: string; selected: boolean }[]>([]);
  const [colorFor, setColorFor] = useState<CalendarRow | null>(null);
  const [colors, setColors] = useState(() => getMobileSettings().calendarColors);
  const [defaultCalendar, setDefaultCalendar] = useState(() => getMobileSettings().defaultCalendar);
  /** What the last cycle said about this account and its lists, and its provider (for the empty-list hint). */
  const [scope, setScope] = useState<{ account?: string; lists?: string; provider: string }>({ provider: "" });
  const reload = useCallback(async () => {
    setCalendars((await listPimCalendars()).filter((calendar) => calendar.accountId === pimAccountId));
    setLists((await listPimTaskLists()).filter((list) => list.accountId === pimAccountId));
    const cache = getPimCache();
    const [account, tasks, rows] = await Promise.all([
      cache?.getScopeState(pimAccountId, "account").catch(() => null) ?? null,
      cache?.getScopeState(pimAccountId, "tasklists").catch(() => null) ?? null,
      listPimAccounts().catch(() => []),
    ]);
    setScope({ account: account?.lastError ?? undefined, lists: tasks?.lastError ?? undefined, provider: rows.find((row) => row.id === pimAccountId)?.provider ?? "" });
  }, [pimAccountId]);
  useEffect(() => { void reload(); }, [reload]);

  const toggleCalendar = (calendar: CalendarRow, selected: boolean) => {
    void setPimCalendarSelected(pimAccountId, calendar.id, selected).then(reload);
  };
  const toggleList = (listId: string, selected: boolean) => {
    void setPimTaskListSelected(pimAccountId, listId, selected).then(reload);
  };
  const pickColor = (calendar: CalendarRow, color: string) => {
    const next = withCalendarColor(colors, pimAccountId, calendar.id, color);
    setColors(next);
    setColorFor(null);
    void updateMobileSettings({ calendarColors: next });
  };
  const writable = calendars.filter((calendar) => !calendar.readOnly && calendar.supportsEvents !== false);
  const options = calendarPickerOptions(writable, new Map(), false);
  const listState = taskListState({ count: lists.length, listsError: scope.lists, accountError: scope.account });
  const lookAgain = () => { pimSyncNow(); window.setTimeout(() => void reload(), 1500); };
  const pickDefault = () => {
    void mSelect({
      title: t("pim.defaultCalendar"),
      options: [{ value: "", label: t("cloudAccounts.defaultElsewhere") }, ...options],
      value: options.some((option) => option.value === defaultCalendar) ? defaultCalendar : "",
    }).then((picked) => {
      if (picked === null) return;
      setDefaultCalendar(picked);
      void updateMobileSettings({ defaultCalendar: picked });
    });
  };

  return (
    <>
      <SectionLabel>{t("pim.calendars")}</SectionLabel>
      <GroupCard>
        <RowList>
          {calendars.length === 0 && <Row title={t("cloudAccounts.noCalendarsYet")} />}
          {calendars.map((calendar) => (
            <Row
              key={calendar.id}
              icon={<span className="pv-dot" style={{ color: calendarColor(calendar, colors) || "var(--accent-color)" }} />}
              title={calendar.name}
              subtitle={calendar.readOnly ? t("cloudAccounts.readOnlyCalendar") : undefined}
              controls
              onClick={() => setColorFor(calendar)}
              end={<Switch checked={calendar.selected} label={calendar.name} onChange={(next) => toggleCalendar(calendar, next)} testId={`account-calendar-${calendar.id}`} />}
            />
          ))}
          {options.length > 0 && (
            <Row
              data-testid="account-calendar-default"
              icon={<CalendarDays size={ICON.ui} />}
              title={t("pim.defaultCalendar")}
              subtitle={options.find((option) => option.value === defaultCalendar)?.label ?? t("cloudAccounts.defaultElsewhere")}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={pickDefault}
            />
          )}
        </RowList>
      </GroupCard>
      {(scope.provider !== "device" || lists.length > 0) && (
        <>
          <SectionLabel>{t("pim.taskLists")}</SectionLabel>
          {listState === "failed" && (
            <Banner kind="error" actions={<Button size="sm" variant="ghost" onClick={lookAgain}>{t("pim.lookAgain")}</Button>}>
              {t("pim.taskListsFailed")} {scope.lists}
            </Banner>
          )}
          {listState === "unknown" && <p className="m-hint" data-testid="pim-tasklists-unknown">{t("pim.taskListsUnknown")}</p>}
          {listState === "empty" && (
            <>
              <p className="m-hint" data-testid="pim-tasklists-empty">{t("pim.noTaskLists")} {t(emptyTaskListHintKey(scope.provider))}</p>
              <GroupCard>
                <RowList>
                  <Row icon={<RefreshCw className="m-accent" size={ICON.ui} />} title={t("pim.lookAgain")} onClick={lookAgain} />
                </RowList>
              </GroupCard>
            </>
          )}
          {lists.length > 0 && <GroupCard>
            <RowList>
              {lists.map((list) => (
                <Row key={list.id} icon={<ListChecks size={ICON.ui} />} title={list.name} controls
                  end={<Switch checked={list.selected} label={list.name} onChange={(next) => toggleList(list.id, next)} testId={`account-tasklist-${list.id}`} />} />
              ))}
            </RowList>
          </GroupCard>}
        </>
      )}
      <GroupCard>
        <RowList>
          <Row data-testid="account-calendar-sync" icon={<RefreshCw className="m-accent" size={ICON.ui} />} title={t("cloudAccounts.syncNow")} onClick={() => pimSyncNow()} />
        </RowList>
      </GroupCard>
      {colorFor && (
        <ColorPickSheet
          value={colors[`${pimAccountId} ${colorFor.id}`] ?? null}
          onPick={(hex) => pickColor(colorFor, hex)}
          onRemove={() => pickColor(colorFor, "")}
          onClose={() => setColorFor(null)}
        />
      )}
    </>
  );
}

/* ---------- mail ---------- */

function MailPart({ mailAccountId }: { mailAccountId: string }) {
  const { t } = useTranslation();
  const vaultId = mailVaultId();
  const [account, setAccount] = useState<MailAccountConfig | null>(null);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [sigAddress, setSigAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState("");
  const reload = useCallback(async () => {
    if (!vaultId) return;
    setAccount((await listMailAccounts(vaultId)).find((entry) => entry.id === mailAccountId) ?? null);
  }, [vaultId, mailAccountId]);
  useEffect(() => {
    void reload();
    window.addEventListener(MAIL_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MAIL_CHANGED_EVENT, reload);
  }, [reload]);
  useEffect(() => {
    if (!account || !vaultId) return;
    setSenders((account.senders ?? []).join("\n"));
    let alive = true;
    void listMailboxesFor(vaultId, account).then((boxes) => { if (alive) setFolders(boxes.map((box) => box.name)); }).catch(() => { if (alive) setFolders([]); });
    return () => { alive = false; };
  }, [account, vaultId]);
  useEffect(() => {
    if (!account) return;
    setSignature(sigAddress ? (account.signatures?.[normalizeSenderAddress(sigAddress)] ?? "") : (account.signature ?? ""));
  }, [account, sigAddress]);
  if (!account || !vaultId) return null;

  const persist = async (patch: Partial<MailAccountConfig>) => {
    await updateMailAccount(vaultId, account.id, patch);
    await reload();
  };
  /** An emptied per-address signature is REMOVED - the address falls back to the default. */
  const persistSignature = async (text: string) => {
    if (!sigAddress) return persist({ signature: text });
    const key = normalizeSenderAddress(sigAddress);
    const next = { ...(account.signatures ?? {}) };
    if (text.trim()) next[key] = text;
    else delete next[key];
    return persist({ signatures: next });
  };
  const pickAddress = () => {
    void mSelect({
      title: t("mail.signatureAddress"),
      options: [{ value: "", label: t("mail.signatureDefault") }, ...senderOptions(account).map((address) => ({ value: address, label: address }))],
      value: sigAddress,
    }).then((picked) => { if (picked !== null) setSigAddress(picked); });
  };

  return (
    <>
      <SectionLabel>{t("cloudAccounts.mailFolders")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row title={folders === null ? t("cloudAccounts.checkRunning") : folders.length ? folders.join(" · ") : t("cloudAccounts.mailFoldersUnavailable")} wrap data-testid="account-mail-folders" />
        </RowList>
      </GroupCard>
      <SectionLabel>{t("mail.sendingGroup")}</SectionLabel>
      {senderOptions(account).length > 1 && (
        <GroupCard>
          <RowList>
            <Row
              data-testid="mail-signature-address"
              title={t("mail.signatureAddress")}
              end={<><span className="m-prop-val">{sigAddress || t("mail.signatureDefault")}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={pickAddress}
            />
          </RowList>
        </GroupCard>
      )}
      <GroupCard><RowList>
        <SettingField label={t("mail.signature")}>
          <TextArea rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} onBlur={() => void persistSignature(signature)} data-testid="mail-signature" />
        </SettingField>
      </RowList></GroupCard>
      <p className="m-hint">{t("mail.signatureHint")}</p>
      <GroupCard><RowList>
        <SettingField label={t("mail.senders")}>
          <TextArea rows={3} value={senders} onChange={(e) => setSenders(e.target.value)} onBlur={() => void persist({ senders: senders.split("\n").map((line) => line.trim()).filter(Boolean) })} data-testid="mail-senders" purpose="address" />
        </SettingField>
      </RowList></GroupCard>
      <p className="m-hint">{t("mail.sendersHint")}</p>
    </>
  );
}
