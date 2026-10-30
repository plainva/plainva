import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { devicePermissionKey } from "../services/pim/devicePermission";
import { devicePimAuthorization, isDevicePimSupported, openDevicePimSettings, type DevicePimStatus } from "../platform/devicePim";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Circle, Plus } from "lucide-react";
import { Banner, Button, calendarTargetForFamily, classifyAuthError, foldMachineText, reviewDuplicatePimRows, familyLabel, GroupCard, ICON, listTemplates, MEETING_TEMPLATE_TOKENS, minutesToTime, reminderDiagnosis, Row, RowList, SectionLabel, SettingField, Switch, TextInput, toast, type CloudProviderFamily, InfoTip, travelsWithVault } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { accessProblemKey, isGoogleAuthorizationCancelled, serviceConnectionMessage, type AccessFamily, type AccessResolution } from "@plainva/ui";
import { getReminderState, subscribeReminderState } from "../services/reminderScheduler";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { mConfirm, mDayTime, mMultiSelect, mSelect } from "../services/mobileDialogs";
import { getMobileSettings, updateMobileSettings, type MobileSettings } from "../services/mobileSettings";
import {
  listPimAccounts,
  listPimCalendars,
  listPimTaskLists,
  pimForegroundSync,
  pimSyncNow,
  setPimCalendarSelected,
  setPimTaskListSelected,
  addPimAccount,
  reauthorizePimAccount,
  getPimCache,
} from "../services/pim/pimService";
import { AccessUnavailableError, beginMobileSignIn, deviceAccess } from "../services/accountSignIn";
import { AccountAccessSheet } from "../components/AccountAccessSheet";
import { toastConnectionFailure } from "../services/connectionToast";
import { caldavUrlFromFiles, getConnectSecrets, rememberConnectSecrets } from "../services/connectSecrets";
import { reauthorizeCalendarAccount } from "../services/pim/pimReauth";
import { accountRowState, deviceSignInStates, isOAuthProvider, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { FolderField } from "../components/FolderField";
import { SheetGrip } from "../components/SheetGrip";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { ConnectRunFooter, ConnectRunFrame } from "../components/ConnectRunFrame";
import { confirmConnectSelection, loadConnectQueue, recordConnectOutcome, runServices } from "../services/connectQueue";
import { useConnectionRun } from "../hooks/useConnectionRun";
import { brokerFamilyOf, canSkipConsent } from "../services/connectConsent";
import { accountTokenCovers, getAccountToken, tokenCoversService } from "../services/accountBroker";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { useLeaveGuard } from "../hooks/useLeaveGuard";

/**
 * Mobile PIM calendar accounts. CalDAV connects with an app password; Google
 * and Microsoft through the one account sign-in of their card, with this
 * device's access (account sign-in plan K4b). Credentials live in the
 * per-vault SecureStore and are never synced, so every device signs in once
 * (package D — the per-device hint below).
 */

type CalRow = PimCalendar & { accountId: string; selected: boolean };

/** Hours worth one tap in the reminder day+time sheet. Not a limit — the time
 *  field takes any value; these are the ones people actually pick, so most
 *  visits end in a single gesture. Module scope: a fresh array per render would
 *  re-create every callback that lists it. */
const HOUR_CHIPS = [7 * 60, 8 * 60, 9 * 60, 12 * 60, 18 * 60];

export function PimAccountsScreen({
  onAddAccount,
  bump,
  onBack,
  family,
  vault,
  accountId,
  onOpenAccountCalendar,
}: {
  bump: number;
  accountId?: string;
  /** The calendar page of one account (plan "Verbinden", V3). */
  onOpenAccountCalendar?: (pimAccountId: string) => void;
  onBack?: () => void;
  /** For the folder browser — a path you have to type is a path you guess. */
  vault: MobileVault;
  /**
   * Set when the user came through the connect wizard (S0a). This screen used
   * to start on "google" no matter where the user came from — the QUIET half of
   * the dropped-family bug: arriving from the Microsoft tile pre-selected
   * Google, and connecting the wrong provider looked completely normal.
   */
  family?: CloudProviderFamily;
  /** "Add account…" opens the connect assistant with the calendar ticked (E7 of the settings plan 2026-10-29). */
  onAddAccount?: () => void;
}) {
  const { t } = useTranslation();
  const run = useConnectionRun();
  const calendarRun = run?.pending[0] === "calendar" && run.context.vaultId === vault.vaultId ? run : null;
  const calendarOutcome = calendarRun?.outcomes.calendar;
  const selectedAccountId = calendarOutcome && "bindingId" in calendarOutcome ? calendarOutcome.bindingId : accountId;
  const [connectionError, setConnectionError] = useState<string | null>(null);
  /** A CalDAV failure of the run's calendar step, with its sender in the frame - no toast (settings plan § 5.1). */
  const [caldavFailure, setCaldavFailure] = useState<unknown>(null);
  /**
   * The calendar of a provider with credentials, proven by the one form of the
   * sign-in step (E5): the step binds it without asking again. Absent in a run
   * resumed after the app was gone - then the form asks once more.
   */
  const provenCaldav = calendarRun && family ? getConnectSecrets().request?.caldav ?? null : null;
  const autoConnected = useRef<string | null>(null);
  const [forceConsent, setForceConsent] = useState(false);
  const calPreset = family ? calendarTargetForFamily(family) : null;
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<CalRow[]>([]);
  const [taskLists, setTaskLists] = useState<Array<{ id: string; name: string; accountId: string; selected: boolean }>>([]);
  const [meetingFolder, setMeetingFolder] = useState(() => getMobileSettings().meetingFolder);
  const [pickMeetingFolder, setPickMeetingFolder] = useState(false);
  const [meetingTemplate, setMeetingTemplate] = useState(() => getMobileSettings().meetingTemplate);
  const [formOpen, setFormOpen] = useState(false);
  const openedRun = useRef<string | null>(null);

  const [defaultCalendar, setDefaultCalendar] = useState(() => getMobileSettings().defaultCalendar);
  const duplicates = useMemo(() => reviewDuplicatePimRows(accounts), [accounts]);
  const [remindEvents, setRemindEvents] = useState(() => getMobileSettings().remindEvents);
  const [remindTasks, setRemindTasks] = useState(() => getMobileSettings().remindTasks);
  const [lead, setLead] = useState(() => getMobileSettings().reminderLeadMinutes);
  const [allDayDays, setAllDayDays] = useState(() => getMobileSettings().reminderAllDayLeadDays);
  const [allDayAt, setAllDayAt] = useState(() => getMobileSettings().reminderAllDayAtMinutes);
  const [taskDays, setTaskDays] = useState(() => getMobileSettings().reminderTaskLeadDays);
  const [taskAt, setTaskAt] = useState(() => getMobileSettings().reminderTaskAtMinutes);
  const [taskTimedLead, setTaskTimedLead] = useState(() => getMobileSettings().reminderTaskTimedLead);
  const [reminderCalendars, setReminderCalendars] = useState<string[]>(() => getMobileSettings().reminderCalendars);
  const reminderState = useSyncExternalStore(subscribeReminderState, getReminderState);
  // The form knows the three network providers; the device account has no form (it is one tap on its tile).
  const [addProvider, setAddProvider] = useState<"google" | "microsoft" | "caldav">(calPreset && calPreset.provider !== "device" ? calPreset.provider : "google");
  const [label, setLabel] = useState("");
  // A run that just connected files knows the server, the user and the
  // password — asking a second time is the complaint, not a safeguard (P4c/
  // P4d). The catalog preset still wins: a suite has a fixed CalDAV endpoint.
  // Only a screen the wizard opened carries a family — and only there may a
  // prefill from an earlier step appear.
  const runSecrets = useMemo(() => (family ? getConnectSecrets() : {}), [family]);
  const [url, setUrl] = useState(
    calPreset?.caldavUrl ?? caldavUrlFromFiles(runSecrets.baseUrl, runSecrets.user) ?? "",
  );
  const [user, setUser] = useState(runSecrets.user ?? runSecrets.email ?? "");
  const [pass, setPass] = useState(runSecrets.password ?? "");
  // Google and Microsoft sign in through the one account sign-in with this
  // device's access (account sign-in plan K4b): no client fields here.
  const [access, setAccess] = useState<AccessResolution | null>(null);
  const [accessFor, setAccessFor] = useState<AccessFamily | null>(null);

  // A CalDAV app password lives in this state until "connect" runs - and a
  // tap on the navigation bar clears the overlay. P0 fixed this class for the
  // mail draft and the vault credentials; this screen was never swept, and it
  // holds the same kind of text (S45).
  useLeaveGuard(
    "pim-accounts",
    !!(url || user || pass),
    t("mobile.leaveCredentials"),
  );
  const [busy, setBusy] = useState(false);
  const connecting = useRef(false);
  /**
   * Set when a connect run's first consent already covered this calendar and
   * the account token is in place — then no second consent is needed (S0b3).
   */
  const [runShare, setRunShare] = useState<{
    provider: "google" | "microsoft";
    label: string;
    vaultId: string;
    accountId: string;
  } | null>(null);
  useEffect(() => {
    if (!calendarRun) return;
    if (calendarOutcome && "bindingId" in calendarOutcome) { setFormOpen(false); return; }
    if (openedRun.current !== calendarRun.id) {
      openedRun.current = calendarRun.id; setFormOpen(!getConnectSecrets().request?.caldav); setConnectionError(null); setCaldavFailure(null); setForceConsent(false);
      setRunShare(null);
    }
  }, [calendarRun, calendarOutcome]);
  useEffect(() => {
    let alive = true;
    void loadConnectQueue().then(async (q) => {
      if (!alive || !q || q.pending[0] !== "calendar") return;
      const broker = brokerFamilyOf(q.family);
      if (!broker) return;
      const vault = await getActiveVaultEntry().catch(() => null);
      if (!vault) return;
      const records = await loadCloudAccounts(vault.id).catch(() => []);
      const candidates = records.filter(r => r.family === q.family && (!q.context.cloudAccountId || r.id === q.context.cloudAccountId));
      const record = candidates.length === 1 ? candidates[0] : undefined;
      if (record && alive) setLabel(record.label);
      const token = record ? await getAccountToken(vault.id, record.id, "calendar", broker).catch(() => null) : null;
      // Whether the shared token EXISTS was the wrong question: a Drive-only
      // grant exists and does not read a calendar, and skipping the consent on
      // that basis is how a row was created that could never sign in (finding
      // 2026-08-19). Ask what it covers.
      const shared =
        !!record && canSkipConsent(q.family, runServices(q), "calendar", tokenCoversService(token, "calendar", broker));
      if (alive && shared && record) {
        setRunShare({ provider: broker, label: record.label ?? "", vaultId: vault.id, accountId: record.id });
      }
    });
    return () => {
      alive = false;
    };
  }, [calendarRun?.id]);
  /** The access this device signs in with, shown on the form (K4b). */
  useEffect(() => {
    if (!formOpen || addProvider === "caldav") return;
    let alive = true;
    void deviceAccess(addProvider).then((resolved) => { if (alive) setAccess(resolved); });
    return () => {
      alive = false;
    };
  }, [addProvider, formOpen]);

  // Sign-in state per account (plan P7). A synced account row without a
  // credential slot on this device is the case the screen used to hide.
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  // The last real failure per account (findings P6.1). The worker has always
  // recorded it; the phone never read it, so an expired token read as "aktiv".
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  /** Which account a CalDAV re-sign-in is for — the form repairs it in place. */
  const [reconnect, setReconnect] = useState<PimAccountRow | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DevicePimStatus | null>(null);

  const reload = useCallback(() => {
    void listPimAccounts()
      .then(async (rows) => {
        setAccounts(rows);
        const vault = await getActiveVaultEntry();
        // The "device" account has no credential slot; its permission is read into `deviceStatus`.
        setSignIn(await deviceSignInStates("pim", vault.id, rows.filter((r) => r.provider !== "device").map((r) => r.id)));
        setDeviceStatus(rows.some((r) => r.provider === "device") && isDevicePimSupported() ? await devicePimAuthorization().catch(() => null) : null);
        const cache = getPimCache();
        const next = new Map<string, string>();
        if (cache) {
          for (const r of rows) {
            const scope = await cache.getScopeState(r.id, "account").catch(() => null);
            if (scope?.lastError) next.set(r.id, scope.lastError);
          }
        }
        setErrors(next);
      })
      .catch(() => setAccounts([]));
    void listPimCalendars().then(setCalendars).catch(() => setCalendars([]));
    void listPimTaskLists().then(setTaskLists).catch(() => setTaskLists([]));
  }, []);

  useEffect(() => { reload(); }, [reload, bump]);
  // Same reason as the calendar (plan Mobile-PIM-Auffrischung, P3): this
  // screen lists the calendars an account holds, and that list only ever
  // fills from a cycle. Opening it is the moment to ask.
  useEffect(() => { pimForegroundSync(); }, []);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("m-pim-changed", onChanged);
    return () => window.removeEventListener("m-pim-changed", onChanged);
  }, [reload]);

  /** Every reminder setting is saved the same way and immediately replans —
   *  a setting that only takes effect at the next sync would look broken. */
  const saveReminder = useCallback((patch: Partial<MobileSettings>, apply: () => void) => {
    apply();
    void updateMobileSettings(patch).then(() =>
      import("../services/reminderScheduler").then((m) => m.rescheduleReminders())
    );
  }, []);

  const allDayLabel = useCallback(
    (days: number, at: number) =>
      t(days > 0 ? "reminders.allDayEvening" : "reminders.allDayMorning", { time: minutesToTime(at) }),
    [t]
  );

  /** 0 is not "zero minutes before" but a different sentence, so it gets its
   *  own one rather than a plural form nothing would read naturally. */
  const leadLabel = useCallback((m: number) => (m === 0 ? t("reminders.leadAtStart") : t("reminders.leadValue", { count: m })), [t]);

  const pickLead = useCallback(async () => {
    const picked = await mSelect({
      title: t("reminders.lead"),
      options: [0, 5, 10, 15, 30, 60, 120].map((m) => ({ value: String(m), label: leadLabel(m) })),
      value: String(lead),
    });
    if (picked === null) return;
    saveReminder({ reminderLeadMinutes: Number(picked) }, () => setLead(Number(picked)));
  }, [lead, leadLabel, saveReminder, t]);

  /** A task with a time reminds at ITS time; this is how long before (E10). */
  const pickTaskTimedLead = useCallback(async () => {
    const picked = await mSelect({
      title: t("reminders.tasksTimedLead"),
      options: [0, 5, 10, 15, 30, 60, 120].map((m) => ({ value: String(m), label: m === 0 ? t("reminders.leadAtTime") : leadLabel(m) })),
      value: String(taskTimedLead),
    });
    if (picked === null) return;
    saveReminder({ reminderTaskTimedLead: Number(picked) }, () => setTaskTimedLead(Number(picked)));
  }, [taskTimedLead, leadLabel, saveReminder, t]);

  const pickAllDay = useCallback(async () => {
    // Used to be six fixed day+time combinations, which hid both questions:
    // you could not see that a day AND an hour were being chosen, and no hour
    // outside the list was reachable. The sheet asks both, and writes the
    // resulting sentence out while you choose (E1).
    const picked = await mDayTime({
      title: t("reminders.allDay"),
      days: [
        { value: 1, label: t("reminders.dayBeforeEvent") },
        { value: 0, label: t("reminders.dayOfEvent") },
      ],
      day: allDayDays,
      minutes: allDayAt,
      suggestions: HOUR_CHIPS,
      preview: (d, m) =>
        t(d > 0 ? "reminders.previewEventBefore" : "reminders.previewEventDay", { time: minutesToTime(m) }),
    });
    if (picked === null) return;
    saveReminder({ reminderAllDayLeadDays: picked.day, reminderAllDayAtMinutes: picked.minutes }, () => {
      setAllDayDays(picked.day);
      setAllDayAt(picked.minutes);
    });
  }, [allDayAt, allDayDays, saveReminder, t]);

  const pickTaskTime = useCallback(async () => {
    // The finding: a task due Friday announced itself at 19:00 on Thursday and
    // never again, because it borrowed the all-day appointment's rule. A task
    // is due ON its day — and which day and hour is now the person's call.
    const picked = await mDayTime({
      title: t("reminders.tasksNoTime"),
      days: [
        { value: 0, label: t("reminders.dayOfDue") },
        { value: 1, label: t("reminders.dayBeforeDue") },
      ],
      day: taskDays,
      minutes: taskAt,
      suggestions: HOUR_CHIPS,
      preview: (d, m) =>
        t(d > 0 ? "reminders.previewDueBefore" : "reminders.previewDueDay", { time: minutesToTime(m) }),
    });
    if (picked === null) return;
    saveReminder({ reminderTaskLeadDays: picked.day, reminderTaskAtMinutes: picked.minutes }, () => {
      setTaskDays(picked.day);
      setTaskAt(picked.minutes);
    });
  }, [saveReminder, t, taskAt, taskDays]);

  /**
   * One line, several outcomes — composed by the SHARED helper so the desktop
   * says the same things in the same order. It used to be an if-chain here,
   * which is exactly how the two shells drift apart.
   */
  const diagnosis = reminderDiagnosis(reminderState, (ts) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts)),
  );
  const reminderDiagnosisLine = reminderState.denied
    ? t("reminders.denied")
    : diagnosis
      ? `${t("reminders.diagPlanned", diagnosis.planned)}${diagnosis.reasonKey ? ` · ${t(diagnosis.reasonKey)}` : ""}`
      : null;

  const taskTimeLabel = useCallback(
    (days: number, at: number) =>
      t(days > 0 ? "reminders.previewDueBefore" : "reminders.previewDueDay", { time: minutesToTime(at) }),
    [t],
  );

  /**
   * Which calendars remind. Several ticks, one sitting.
   *
   * This used to be `mSelect`, which is a SINGLE choice by contract: it resolves
   * on the first tap and the sheet closes. Ticking three calendars therefore
   * meant opening the same sheet three times and finding your place again — the
   * finding the maintainer reported. The tick mark was even faked into the
   * label (`"✓ " + name`), which is what a single-choice sheet forces you to do.
   *
   * An EMPTY stored list means ALL, so the sheet may not hand back nothing:
   * `minSelected: 1` makes the last tick refuse rather than silently mean the
   * opposite.
   */
  /**
   * What the row says BEFORE it is tapped (D9, 2026-08-24).
   *
   * It used to read "Alle" whenever the stored list was empty — which is true
   * for "every calendar reminds" and equally true for "there is not one
   * calendar", two states that could not look more different to a reader. The
   * second one is exactly the one where tapping did nothing.
   */
  const calendarsValueLabel =
    calendars.length === 0
      ? accounts.length === 0
        ? t("reminders.calendarsNoAccount")
        : t("reminders.calendarsNone")
      : reminderCalendars.length === 0
        ? t("reminders.calendarsAll")
        : t("reminders.calendarsSome", { count: reminderCalendars.length, total: calendars.length });

  const pickCalendars = useCallback(async () => {
    // An empty list used to return here without a word, while the row went on
    // looking exactly as operable as any other — chevron, value, the lot. That
    // is the finding (D9, 2026-08-24) and the same class as the mail empty
    // state: a control whose reservation you cannot see. It answers now, and
    // the answer differs by WHY the list is empty.
    if (calendars.length === 0) {
      if (accounts.length === 0) {
        await mConfirm({
          title: t("reminders.calendars"),
          message: t("reminders.calendarsNoAccountHint"),
          confirmLabel: t("common.ok"),
        });
        return;
      }
      const refresh = await mConfirm({
        title: t("reminders.calendars"),
        message: t("reminders.calendarsNoneHint"),
        confirmLabel: t("pim.refreshNow"),
      });
      // An explicit ask bypasses the foreground throttle: the person in front of
      // the phone just said "now", and a silent no-op is what got us here.
      if (refresh) pimSyncNow();
      return;
    }
    const all = calendars.map((c) => `${c.accountId} ${c.id}`);
    const active = reminderCalendars.length === 0 ? all : reminderCalendars;
    const picked = await mMultiSelect({
      title: t("reminders.calendars"),
      options: calendars.map((c) => ({ value: `${c.accountId} ${c.id}`, label: c.name })),
      values: active,
      minSelected: 1,
    });
    if (picked === null) return;
    // "All of them" is stored as the empty list, so a calendar added later
    // reminds by default instead of falling through a list written before it
    // existed.
    const stored = picked.length === calendars.length ? [] : picked;
    saveReminder({ reminderCalendars: stored }, () => setReminderCalendars(stored));
  }, [accounts, calendars, reminderCalendars, saveReminder, t]);

  const pickDefaultCalendar = async () => {
    const options = [
      { value: "", label: t("pim.defaultCalendarFirst") },
      ...calendars.map((c) => ({ value: `${c.accountId} ${c.id}`, label: c.name })),
    ];
    // A value with a state (E20): the ring sits on the calendar in force.
    const picked = await mSelect({ title: t("pim.defaultCalendar"), options, value: defaultCalendar });
    if (picked === null) return;
    setDefaultCalendar(picked);
    await updateMobileSettings({ defaultCalendar: picked });
  };

  /**
   * Meeting-note template (plan Befunde 24.09., E24) — the daily note's picker,
   * for meetings. A value typed on the desktop that is not in the templates
   * folder stays listed instead of turning into "—".
   */
  const pickMeetingTemplate = async () => {
    const items = await listTemplates(vault.adapter, getMobileSettings().templateFolder || "Templates").catch(() => []);
    const files = items.map((it) => ({ value: it.path.split("/").pop() ?? it.path, label: it.title }));
    const picked = await mSelect({
      title: t("pim.meetingTemplate"),
      options: [
        { value: "", label: "—" },
        ...(meetingTemplate && !files.some((f) => f.value === meetingTemplate) ? [{ value: meetingTemplate, label: meetingTemplate }] : []),
        ...files,
      ],
      value: meetingTemplate,
    });
    if (picked === null) return;
    setMeetingTemplate(picked);
    await updateMobileSettings({ meetingTemplate: picked });
  };

  /** The account this form repairs, if it is of the provider being filled in. */
  const reconnectFor = (provider: string) => (reconnect?.provider === provider ? reconnect : null);

  const connectCaldav = async (proven?: { url: string; user: string; pass: string }) => {
    // An address as a machine reads it (lib/machineText.ts).
    const u = foldMachineText(proven?.url ?? url);
    const name = (proven?.user ?? user).trim();
    const secret = proven?.pass ?? pass;
    if (!u || !name || !secret) return;
    setBusy(true);
    setCaldavFailure(null);
    try {
      const host = (() => { try { return new URL(u).host; } catch { return u; } })();
      const target = reconnectFor("caldav");
      if (target) {
        await reauthorizePimAccount(target.id, { kind: "caldav", url: u, user: name, pass: secret }, calendarRun?.context);
        await recordConnectOutcome(calendarRun?.context, "calendar", { state: "alreadyConnected", bindingId: target.id });
      } else {
        await addPimAccount("caldav", label.trim() || host, { kind: "caldav", url: u, user: name, pass: secret }, calendarRun?.context);
      }
      // Carried to the mail step of the same run — in memory only (E4).
      rememberConnectSecrets({ baseUrl: u, user: name, password: secret });
      setLabel(""); setUrl(""); setUser(""); setPass(""); setReconnect(null);
      toast.success(
        target
          ? t("pim.accountReconnected", { defaultValue: "Konto neu angemeldet" })
          : t("pim.accountAdded", { defaultValue: "Konto verbunden" })
      );
      reload();
    } catch (e) {
      // In the setup the frame says it, with its sender; outside it the sheet's toast.
      if (calendarRun) setCaldavFailure(e);
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // The proven calendar binds on its own, once per run; a retry is the frame's button.
  useEffect(() => {
    if (!calendarRun || !provenCaldav || calendarOutcome || autoConnected.current === calendarRun.id) return;
    autoConnected.current = calendarRun.id;
    void connectCaldav(provenCaldav);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run: the effect is the step starting
  }, [calendarRun?.id, provenCaldav, calendarOutcome]);

  // Google/Microsoft open the system browser (OAuth); the account is added when
  // the redirect returns (handlePimOAuthRedirect -> addPimAccount -> m-pim-changed),
  // or its credential replaced in place when the flow carries an accountId.
  /**
   * Inside a run whose first consent already covered the calendar (S0b3), the
   * account is created WITHOUT a second consent: the credential carries no
   * refresh token of its own, and `pimAuth` probes the account broker before it
   * would look for one. That is the same shape `accountLogin` leaves behind
   * when it merges an account after the fact — this just gets there without the
   * extra prompt.
   */
  const addViaAccountToken = async (provider: "google" | "microsoft"): Promise<boolean> => {
    if (!runShare || runShare.provider !== provider || forceConsent) return false;
    // Re-checked at the moment of use, not just when the screen loaded: the
    // shared token can be replaced or cleared in between, and creating a row
    // whose sign-in turns out to be absent produces `no_stored_sign_in` on the
    // very next cycle — with no consent left to fall back on (finding
    // 2026-08-19). If it no longer covers the calendar, the regular consent runs.
    if (!(await accountTokenCovers(runShare.vaultId, runShare.accountId, "calendar", provider))) return false;
    // The row names the client of its card's sign-in; the sign-in itself stays the card's.
    const token = await getAccountToken(runShare.vaultId, runShare.accountId, "calendar", provider).catch(() => null);
    if (!token?.clientId) return false;
    const creds =
      provider === "google"
        ? ({ kind: "google", clientId: token.clientId, clientSecret: token.clientSecret ?? "", refreshToken: "" } as const)
        : ({ kind: "microsoft", clientId: token.clientId, refreshToken: "" } as const);
    await addPimAccount(provider, label.trim() || runShare.label, creds, { ...calendarRun?.context, vaultId: runShare.vaultId, cloudAccountId: runShare.accountId });
    toast.success(t("pim.accountAdded", { defaultValue: "Konto verbunden" }));
    reload();
    return true;
  };

  /**
   * Google and Microsoft: inside a run whose sign-in covers the calendar, the
   * row is made from the card's grant without a consent. Otherwise this is the
   * one account sign-in with "calendar" added - for the run's card, or a new
   * account - exactly as the wizard does; the run that follows brings the
   * person back here to make the row (account sign-in plan K4b).
   */
  const connectAccount = async (provider: "google" | "microsoft") => {
    if (connecting.current) return;
    connecting.current = true;
    setBusy(true);
    try {
      if (await addViaAccountToken(provider)) return;
      setConnectionError(null);
      const vaultId = runShare?.vaultId ?? (await getActiveVaultEntry()).id;
      const cardId = runShare?.provider === provider ? runShare.accountId : calendarRun?.family === provider ? calendarRun.context.cloudAccountId : undefined;
      await beginMobileSignIn(vaultId, { family: provider, ...(cardId ? { cardId } : {}), add: ["calendar"] });
    } catch (e) {
      if (e instanceof AccessUnavailableError) { setAccessFor(e.family); return; }
      setConnectionError(e instanceof Error ? e.message : String(e));
      setForceConsent(true);
    } finally { connecting.current = false; setBusy(false); }
  };

  /**
   * "Erneut anmelden" — the same consent flow as connecting, bound to the same
   * account id, so the row keeps its calendars and every mirrored task keeps its
   * anchor. Deleting and re-adding was the old advice and cost all of that.
   *
   * For an expired grant the credential slot is still there, so the client id it
   * was created with is reused — the user does not have to dig it out again. A
   * slot that is gone entirely has no id to reuse: Google then needs the form
   * (BYO), Microsoft falls back to the shipped app.
   */
  const signInAgain = async (a: PimAccountRow) => {
    setReconnect(a);
    const out = await reauthorizeCalendarAccount(a);
    if (out.kind === "needsForm") {
      // OPEN the form the answer points at (finding 2026-08-19): CalDAV renews
      // with its address and password.
      setAddProvider("caldav");
      setLabel(a.label);
      setFormOpen(true);
      toast.info(t("pim.reconnectCaldavHint", { defaultValue: "Trage die Serveradresse und das Passwort unten erneut ein." }));
      return;
    }
    // Google and Microsoft sign the card in again; without a usable access the sheet asks for one.
    if (out.kind === "needsAccess") { setAccessFor(out.family); return; }
    if (out.kind === "failed") toastConnectionFailure(out.error);
  };


  const [selectionPending, setSelectionPending] = useState(0);
  const toggleTaskList = async (l: { id: string; accountId: string; selected: boolean }) => {
    setSelectionPending(n => n + 1);
    try {
      await setPimTaskListSelected(l.accountId, l.id, !l.selected);
      setTaskLists((ls) =>
        ls.map((x) => (x.accountId === l.accountId && x.id === l.id ? { ...x, selected: !x.selected } : x)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    finally { setSelectionPending(n => n - 1); }
  };

  const toggleCal = async (c: CalRow) => {
    setSelectionPending(n => n + 1);
    try {
      await setPimCalendarSelected(c.accountId, c.id, !c.selected);
      setCalendars((cs) => cs.map((x) => (x.accountId === c.accountId && x.id === c.id ? { ...x, selected: !x.selected } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setSelectionPending(n => n - 1); }
  };

  /** What the meeting template may use — behind its info, with the guide (3.4 A). */
  const meetingTemplateInfo = [t("pim.meetingTemplateHint"), `${t("pim.meetingTemplatePlaceholders")} ${MEETING_TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(" ")}`].join("\n\n");

  const canConnect = url.trim().length > 0 && user.trim().length > 0 && pass.length > 0 && !busy;

  /**
   * The accounts (settings plan 2026-10-29, B1, move 34): the first group of the
   * page outside a setup run — the accounts feed everything below them. Inside a
   * run the same list is the step that picks the calendars and lists.
   */
  const accountsSection = (
    <>
      {!calendarRun &&
        <GroupCard>
          <RowList>
            <Row
              data-testid="pim-account-add"
              icon={<Plus size={ICON.ui} />}
              onClick={() => (onAddAccount ? onAddAccount() : setFormOpen(true))}
              title={t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}
            />
          </RowList>
        </GroupCard>
        }
        {/* Duplicated rows are named rather than folded: a calendar row carries
            the selection, the cached events and every mirrored task's anchor,
            so removing the right one is a decision. Until now nothing said
            they were duplicates at all (finding 2026-08-19). */}
        {duplicates.map((need) => (
          <Banner key={need.accountIds.join(",")} kind="warning" rounded>
            {t(need.reason === "same-identity" ? "pim.duplicateSameIdentity" : "pim.duplicateSameLabel", {
              label: need.label,
              n: need.accountIds.length,
            })}
          </Banner>
        ))}
        {accounts.length === 0 ? (
          <p className="m-hint">{t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}</p>
        ) : (
          accounts.filter(a => selectedAccountId ? a.id === selectedAccountId : !calendarRun).map((a) => {
            const cals = calendars.filter((c) => c.accountId === a.id);
            const failure = errors.get(a.id);
            const state = accountRowState(signIn.get(a.id) ?? "active", failure);
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-acct" data-testid={`pim-account-${a.id}`}>
                  <span className="m-acct-name">{a.label}</span>
                  <DeviceSignInBadge state={state} />
                  <span className="m-acct-provider">{a.provider === "device" ? t("cloudAccounts.familyDevice") : a.provider}</span>
                </div>
                {a.provider === "device" && deviceStatus && deviceStatus.events !== "fullAccess" && (
                  /* The device account's "sign-in" is the permission: the hint names
                     its state and offers the system settings, never a second dialog. */
                  <>
                    <p className="m-hint m-acct-hint" data-testid={`pim-account-hint-${a.id}`}>
                      {t(devicePermissionKey(deviceStatus.events))} — {t("pim.deviceAccessNeeded")}
                    </p>
                    <Button onClick={() => void openDevicePimSettings()} size="sm" variant="tonal">
                      {t("pim.deviceOpenSettings")}
                    </Button>
                  </>
                )}
                {a.provider !== "device" && state !== "active" && (
                  /* The row alone would only say something is wrong — this says
                     what, and offers the one action that fixes it. */
                  <>
                    <p className="m-hint m-acct-hint" data-testid={`pim-account-hint-${a.id}`}>
                      {state === "expired"
                        ? a.provider === "google"
                          ? t("pim.authExpiredGoogleShort")
                          : t("pim.authExpired")
                        : isOAuthProvider(a.provider)
                          ? t("deviceSignIn.rowHintOauth")
                          : t("deviceSignIn.rowHintStatic")}
                      {state === "expired" && a.provider === "google" && <InfoTip label={a.label} info={t("pim.authExpiredGoogle")} />}
                    </p>
                    <Button
                      variant="tonal"
                      data-testid={`pim-account-reauth-${a.id}`}
                      onClick={() => void signInAgain(a)}
                    >
                      {t("cloudAccounts.reconnect")}
                    </Button>
                  </>
                )}
                {/* A failure that re-signing does NOT fix still has to be
                    visible — a wrong client id or a dead network read as an
                    empty calendar before, with nothing on screen to explain it.
                    The provider's own words stay below the advice. */}
                {state === "active" && failure && (
                  <p className="m-hint m-acct-hint" data-testid={`pim-account-error-${a.id}`}>
                    {classifyAuthError(failure) === "config"
                      ? t("pim.authConfig")
                      : classifyAuthError(failure) === "network"
                        ? t("pim.authNetwork")
                        : t("pim.accountFailed")}
                    <br />
                    <span style={{ color: "var(--text-faint)" }}>{failure}</span>
                  </p>
                )}
                {/* Inside a connect run this IS the step that picks the calendars and
                    lists ("connection.selectResources"). Outside one, the calendars and
                    lists of ONE account, its switch and its colours live on that
                    account's calendar page (plan "Verbinden", V3); removing the
                    account lives on the account page (E2). */}
                {calendarRun ? (
                  <>
                    {cals.length > 0 && (
                      <GroupCard>
                        <RowList>
                          {cals.map((c) => (
                            <Row
                              end={c.selected ? <Check className="m-accent" size={ICON.ui} /> : undefined}
                              icon={<Circle className="m-caldot" fill="currentColor" size={ICON.meta} style={{ color: c.color || "var(--accent-color)" }} />}
                              indent={1}
                              key={c.id}
                              onClick={() => void toggleCal(c)}
                              title={c.name}
                            />
                          ))}
                        </RowList>
                      </GroupCard>
                    )}
                    <SectionLabel className="m-sectionlabel--inset">{t("pim.taskLists")}</SectionLabel>
                    {taskLists.filter((l) => l.accountId === a.id).length === 0 ? (
                      <p className="m-hint">{t("pim.noTaskLists")}</p>
                    ) : (
                      <GroupCard>
                        <RowList>
                          {taskLists
                            .filter((l) => l.accountId === a.id)
                            .map((l) => (
                              <Row
                                end={l.selected ? <Check className="m-accent" size={ICON.ui} /> : undefined}
                                indent={1}
                                key={l.id}
                                onClick={() => void toggleTaskList(l)}
                                title={l.name}
                              />
                            ))}
                        </RowList>
                      </GroupCard>
                    )}
                  </>
                ) : (
                  <GroupCard>
                    <RowList>
                      <Row
                        indent={1}
                        data-testid={`pim-account-calendars-${a.id}`}
                        title={t("cloudAccounts.openAccountCalendar")}
                        subtitle={t("cloudAccounts.calendarSummary", {
                          calendars: cals.filter((c) => c.selected).length,
                          lists: taskLists.filter((l) => l.accountId === a.id && l.selected).length,
                        })}
                        end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                        onClick={() => onOpenAccountCalendar?.(a.id)}
                      />
                    </RowList>
                  </GroupCard>
                )}
              </div>
            );
          })
        )}

    </>
  );

  return (
    <div className="m-page">
      {/* A step of the account setup (plan "Verbinden-Assistent", 2026-10-28):
          the setup's frame instead of the screen's bar and a banner. */}
      {calendarRun ? (
        <ConnectRunFrame
          run={calendarRun}
          service="calendar"
          heading={t("connectRun.calendarHeading")}
          failure={caldavFailure ?? connectionError ?? undefined}
          onLeave={() => { setFormOpen(false); onBack?.(); }}
          onRetry={provenCaldav ? () => void connectCaldav(provenCaldav) : () => setFormOpen(true)}
          onSignIn={provenCaldav ? () => void connectCaldav(provenCaldav) : () => setFormOpen(true)}
        />
      ) : (
        <AppBar onBack={() => onBack?.()} title={t("pim.accounts", { defaultValue: "Kalenderkonten" })} />
      )}

      <div className="m-settings">
        {calendarRun && provenCaldav && busy && (
          <GroupCard>
            <RowList>
              <Row icon={<span className="m-actionspin" aria-hidden />} title={t("pim.connecting")} data-testid="pim-caldav-progress" />
            </RowList>
          </GroupCard>
        )}
        {!calendarRun && <>
        {/* Per-device sign-in: the state of each account says it now
            ("Not signed in on this device"), the sentence over the page went
            (settings plan 2026-10-29, Q1). */}
        <SectionLabel>{t("pim.groupAccounts")}</SectionLabel>
        {accountsSection}

        {/* Calendar settings (S27): the default calendar a new event starts in,
            and where a meeting note lands — settings of the vault and the
            person, so they travel with the profile. Two groups since the
            settings plan of 2026-10-29 (moves 32, 33), as on the desktop. */}
        <SectionLabel>{t("pim.groupEvents")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{calendars.find((c) => `${c.accountId} ${c.id}` === defaultCalendar)?.name ?? t("pim.defaultCalendarFirst")}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickDefaultCalendar()}
              title={t("pim.defaultCalendar")}
            />
          </RowList>
        </GroupCard>
        <SectionLabel>{t("pim.groupMeetingNotes")}</SectionLabel>
        <GroupCard>
          <RowList>
            <FolderField
              info={t("pim.meetingFolderHint")}
              label={t("pim.meetingFolder")}
              normalize={(v) => v.trim()}
              onSave={(v) => { setMeetingFolder(v); void updateMobileSettings({ meetingFolder: v }); }}
              onPick={() => setPickMeetingFolder(true)}
              placeholder="Meetings"
              value={meetingFolder}
            />
            <Row
              data-testid="pim-meeting-template"
              end={<><span className="m-prop-val">{meetingTemplate ? meetingTemplate.replace(/.md$/i, "") : "—"}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              info={{ text: meetingTemplateInfo, guide: "Calendar_and_Tasks.md" }}
              onClick={() => void pickMeetingTemplate()}
              title={t("pim.meetingTemplate")}
            />
          </RowList>
        </GroupCard>

        {/* Reminders (S10) as their own section, the shape the target picture
            gives it. The remaining rows — lead time, all-day rule, tasks, which
            calendars — join in S11; the switch is here already because it is
            what asks for the notification permission. */}
        <SectionLabel deviceOnly={!travelsWithVault(undefined, "mobile")} info={t("reminders.window")}>{t("reminders.section")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              end={<Switch
                checked={remindEvents}
                label={t("reminders.enable")}
                onChange={(next) => saveReminder({ remindEvents: next }, () => setRemindEvents(next))}
              />}
              title={t("reminders.enable")}
            />
            <Row
              end={<><span className="m-prop-val">{leadLabel(lead)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickLead()}
              title={t("reminders.lead")}
            />
            <Row
              end={<><span className="m-prop-val">{allDayLabel(allDayDays, allDayAt)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickAllDay()}
              title={t("reminders.allDay")}
            />
            <Row
              end={<><span className="m-prop-val">{calendarsValueLabel}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickCalendars()}
              title={t("reminders.calendars")}
            />
            <Row
              end={<Switch
                checked={remindTasks}
                label={t("reminders.tasks")}
                onChange={(next) => saveReminder({ remindTasks: next }, () => setRemindTasks(next))}
              />}
              title={t("reminders.tasks")}
            />
            {/* Directly under the switch it belongs to: on its own it would read
                like a second, unrelated task setting. */}
            {remindTasks ? (
              <Row
                end={<><span className="m-prop-val">{taskTimeLabel(taskDays, taskAt)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                onClick={() => void pickTaskTime()}
                title={t("reminders.tasksNoTime")}
              />
            ) : null}
            {remindTasks ? (
              <Row
                data-testid="reminder-task-timed-lead"
                end={<><span className="m-prop-val">{taskTimedLead === 0 ? t("reminders.leadAtTime") : leadLabel(taskTimedLead)}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                onClick={() => void pickTaskTimedLead()}
                info={t("reminders.tasksTimedLeadDesc")}
                title={t("reminders.tasksTimedLead")}
              />
            ) : null}
          </RowList>
        </GroupCard>
        {/* What the scheduler actually did, and when it did nothing, why
            (plan Mobile-Feedback, P1/5). Task reminders hang on three silent
            conditions — the switch, a task database that only reaches the phone
            through the settings sync, and a due column typed as a date — and
            every one of them produced the same unexplained silence. */}
        {reminderDiagnosisLine ? <p className="m-hint">{reminderDiagnosisLine}</p> : null}
        {reminderState.denied ? <Banner kind="warning" rounded>{t("reminders.denied")}</Banner> : null}
        {reminderState.truncatedFrom !== null ? (
          <Banner kind="warning" rounded>
            {t("reminders.truncated", {
              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(reminderState.truncatedFrom)),
            })}
          </Banner>
        ) : null}
        </>}
        {calendarRun && accountsSection}
        {/* Was a naked <h2> with an inline font size — larger than the app-bar
            title above it. It is a section heading like every other. */}
      </div>

      {/* The add form is a SHEET, like the mail one: as the last section of a
          long page nothing visibly happened when you asked for it. */}
      {formOpen && (
        <div className={calendarRun ? "m-connect-form" : "m-sheet-backdrop"} onClick={() => { if (!calendarRun) setFormOpen(false); }}>
          <div className={calendarRun ? "m-settings" : "pv-sheet m-sheet"} onClick={(e) => e.stopPropagation()}>
            {!calendarRun && <SheetGrip onClose={() => setFormOpen(false)} />}
            {/* In a setup run the frame says it, once, with its sender. */}
            {!calendarRun && (connectionError || calendarOutcome?.state === "failed") && <Banner kind={isGoogleAuthorizationCancelled(connectionError) ? "info" : "warning"} rounded>{serviceConnectionMessage(new Error(connectionError ?? (calendarOutcome?.state === "failed" ? calendarOutcome.message : undefined) ?? "loginFailed"), t)}</Banner>}
            <p className="m-sheet-title">
              {family ? familyLabel(family) : t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}
            </p>
        {/* Provider chooser — Google / Microsoft (OAuth) / CalDAV (app password).
                Hidden when the wizard already settled it (S0a): leaving it here was
                the silent half of the bug, because the control defaults to Google
                and arriving from the Microsoft tile looked entirely plausible. */}

            <SettingField label={t("pim.accountLabel", { defaultValue: "Bezeichnung (optional)" })}>
              <TextInput onChange={(e) => setLabel(e.target.value)} value={label} placeholder={addProvider === "google" ? "Google" : addProvider === "microsoft" ? "Outlook" : "Fastmail"} />
            </SettingField>

            {(addProvider === "google" || addProvider === "microsoft") && (
              <>
                <GroupCard>
                  <RowList>
                    <Row
                      data-testid="pim-access"
                      title={t("accountAccess.lineLabel")}
                      subtitle={!access ? "" : access.ok ? (access.access.source === "plainva" ? t("accountAccess.plainva") : t("accountAccess.ownLine", { id: access.access.clientId })) : t(accessProblemKey(access.problem))}
                      end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                      onClick={() => setAccessFor(addProvider)}
                      wrap
                    />
                  </RowList>
                </GroupCard>
                <Button variant="primary" disabled={busy} onClick={() => void connectAccount(addProvider)}>
                  <Plus size={ICON.ui} /> {t(runShare && !forceConsent ? "connection.useSignIn" : addProvider === "google" ? "connection.grantGoogle" : "pim.connectMicrosoft")}
                </Button>
              </>
            )}

            {addProvider === "caldav" && (
              <>
                <p className="m-hint">{t("pim.connectCaldavShort")}<InfoTip label={t("pim.addAccount", { defaultValue: "Konto hinzufügen" })} info={t("pim.connectCaldavHint")} /></p>
                <SettingField label={t("pim.caldavUrl", { defaultValue: "CalDAV-URL" })}>
                  <TextInput purpose="address" inputMode="url" onChange={(e) => setUrl(e.target.value)} value={url} placeholder="https://caldav.fastmail.com/dav/calendars/user/name/" />
                </SettingField>
                <SettingField label={t("mobile.syncUser", { defaultValue: "Benutzer" })}>
                  <TextInput onChange={(e) => setUser(e.target.value)} value={user} />
                </SettingField>
                <SettingField label={t("mobile.syncPassword", { defaultValue: "Passwort" })}>
                  <TextInput type="password" onChange={(e) => setPass(e.target.value)} value={pass} />
                </SettingField>
                <Button variant="primary" disabled={!canConnect} onClick={() => void connectCaldav()} data-testid="pim-caldav-connect">
                  <Plus size={ICON.ui} /> {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {pickMeetingFolder && (
        <FolderPickerSheet
          onClose={() => setPickMeetingFolder(false)}
          onPick={(path) => {
            setMeetingFolder(path);
            void updateMobileSettings({ meetingFolder: path });
          }}
          title={t("settings.browseFolders")}
          vault={vault}
        />
      )}
      {accessFor && (
        <AccountAccessSheet
          family={accessFor}
          onCancel={() => setAccessFor(null)}
          onSaved={() => { const family = accessFor; setAccessFor(null); if (family !== "dropbox") void deviceAccess(family).then(setAccess); }}
        />
      )}
      {calendarRun && (
        <ConnectRunFooter
          run={calendarRun}
          service="calendar"
          primary={calendarRun.outcomes.calendar && "bindingId" in calendarRun.outcomes.calendar
            ? <Button variant="primary" disabled={selectionPending > 0} data-testid="connectrun-next" onClick={() => void confirmConnectSelection()}>{t("common.next")}</Button>
            : undefined}
        />
      )}
    </div>
  );
}
