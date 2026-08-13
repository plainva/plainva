import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Circle, Plus, Trash2 } from "lucide-react";
import { Banner, Button, classifyAuthError, familyLabel, GroupCard, ICON, IconButton, minutesToTime, PLAINVA_ONEDRIVE_CLIENT_ID, Row, RowList, SectionLabel, Segmented, Switch, TextInput, toast, type CloudProviderFamily } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { calendarTargetForFamily } from "../services/familyTarget";
import { getReminderState, subscribeReminderState } from "../services/reminderScheduler";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import { getMobileSettings, updateMobileSettings, type MobileSettings } from "../services/mobileSettings";
import {
  listPimAccounts,
  listPimCalendars,
  listPimTaskLists,
  setPimCalendarSelected,
  setPimTaskListSelected,
  addPimAccount,
  reauthorizePimAccount,
  removePimAccount,
  getPimCache,
} from "../services/pim/pimService";
import { beginPimOAuth } from "../services/pim/pimOAuth";
import { reauthorizeCalendarAccount } from "../services/pim/pimReauth";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { accountRowState, deviceSignInStates, isOAuthProvider, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";
import { AppBar } from "../components/AppBar";
import { ConnectRunBanner } from "../components/ConnectRunBanner";
import { useLeaveGuard } from "../hooks/useLeaveGuard";

/**
 * Mobile PIM calendar accounts. All three providers connect on-device: CalDAV
 * with an app password, Google (BYO client id) and Microsoft (central app id)
 * via the system-browser OAuth flow (beginPimOAuth → handlePimOAuthRedirect).
 * Credentials live in the per-vault SecureStore and are never synced, so every
 * device signs in once (package D — the per-device hint below).
 */

type CalRow = PimCalendar & { accountId: string; selected: boolean };

export function PimAccountsScreen({
  bump,
  onBack,
  family,
}: {
  bump: number;
  onBack?: () => void;
  /**
   * Set when the user came through the connect wizard (S0a). This screen used
   * to start on "google" no matter where the user came from — the QUIET half of
   * the dropped-family bug: arriving from the Microsoft tile pre-selected
   * Google, and connecting the wrong provider looked completely normal.
   */
  family?: CloudProviderFamily;
}) {
  const { t } = useTranslation();
  const calPreset = family ? calendarTargetForFamily(family) : null;
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<CalRow[]>([]);
  const [taskLists, setTaskLists] = useState<Array<{ id: string; name: string; accountId: string; selected: boolean }>>([]);
  const [meetingFolder, setMeetingFolder] = useState(() => getMobileSettings().meetingFolder);
  const [defaultCalendar, setDefaultCalendar] = useState(() => getMobileSettings().defaultCalendar);
  const [remindEvents, setRemindEvents] = useState(() => getMobileSettings().remindEvents);
  const [remindTasks, setRemindTasks] = useState(() => getMobileSettings().remindTasks);
  const [lead, setLead] = useState(() => getMobileSettings().reminderLeadMinutes);
  const [allDayDays, setAllDayDays] = useState(() => getMobileSettings().reminderAllDayLeadDays);
  const [allDayAt, setAllDayAt] = useState(() => getMobileSettings().reminderAllDayAtMinutes);
  const [reminderCalendars, setReminderCalendars] = useState<string[]>(() => getMobileSettings().reminderCalendars);
  const reminderState = useSyncExternalStore(subscribeReminderState, getReminderState);
  const [addProvider, setAddProvider] = useState<"google" | "microsoft" | "caldav">(calPreset?.provider ?? "google");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState(calPreset?.caldavUrl ?? "");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [gClientId, setGClientId] = useState("");
  const [gClientSecret, setGClientSecret] = useState("");
  // Microsoft uses the shipped central client id; the field stays EMPTY and
  // hidden (never expose our app id). beginPimOAuth falls back to the central
  // id when this is blank — an opt-in reveals the field for a user's own.
  const [msClientId, setMsClientId] = useState("");

  // A CalDAV app password and a Google client secret live in this state until
  // "connect" runs — and a tap on the navigation bar clears the overlay. P0
  // fixed this class for the mail draft and the vault credentials; this screen
  // was never swept, and it holds the same kind of text (S45).
  useLeaveGuard(
    "pim-accounts",
    !!(url || user || pass || gClientId || gClientSecret || msClientId),
    t("mobile.leaveCredentials"),
  );
  const [msShowId, setMsShowId] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sign-in state per account (plan P7). A synced account row without a
  // credential slot on this device is the case the screen used to hide.
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  // The last real failure per account (findings P6.1). The worker has always
  // recorded it; the phone never read it, so an expired token read as "aktiv".
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  /** Which account a CalDAV re-sign-in is for — the form repairs it in place. */
  const [reconnect, setReconnect] = useState<PimAccountRow | null>(null);

  const reload = useCallback(() => {
    void listPimAccounts()
      .then(async (rows) => {
        setAccounts(rows);
        const vault = await getActiveVaultEntry();
        setSignIn(await deviceSignInStates("pim", vault.id, rows.map((r) => r.id)));
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

  const pickAllDay = useCallback(async () => {
    // Day and time as ONE choice: "the evening before, 08:00" would be a
    // reading nobody means, so the options only offer sentences that hold.
    const combos: Array<[number, number]> = [[1, 18 * 60], [1, 19 * 60], [1, 20 * 60], [0, 7 * 60], [0, 8 * 60], [0, 9 * 60]];
    const picked = await mSelect({
      title: t("reminders.allDay"),
      options: combos.map(([d, m]) => ({ value: `${d}:${m}`, label: allDayLabel(d, m) })),
      value: `${allDayDays}:${allDayAt}`,
    });
    if (picked === null) return;
    const [d, m] = picked.split(":").map(Number);
    saveReminder({ reminderAllDayLeadDays: d, reminderAllDayAtMinutes: m }, () => {
      setAllDayDays(d);
      setAllDayAt(m);
    });
  }, [allDayAt, allDayDays, allDayLabel, saveReminder, t]);

  /** Toggles one calendar. An EMPTY list means all — so unticking the last one
   *  would silently mean "all again"; the last tick therefore stays. */
  const pickCalendars = useCallback(async () => {
    if (calendars.length === 0) return;
    const active = reminderCalendars.length === 0 ? calendars.map((c) => `${c.accountId} ${c.id}`) : reminderCalendars;
    const picked = await mSelect({
      title: t("reminders.calendars"),
      options: calendars.map((c) => {
        const key = `${c.accountId} ${c.id}`;
        return { value: key, label: `${active.includes(key) ? "✓ " : ""}${c.name}` };
      }),
      value: "",
    });
    if (picked === null) return;
    const next = active.includes(picked) ? active.filter((k) => k !== picked) : [...active, picked];
    if (next.length === 0) return;
    const stored = next.length === calendars.length ? [] : next;
    saveReminder({ reminderCalendars: stored }, () => setReminderCalendars(stored));
  }, [calendars, reminderCalendars, saveReminder, t]);

  const pickDefaultCalendar = async () => {
    const options = [
      { value: "", label: t("pim.defaultCalendarFirst") },
      ...calendars.map((c) => ({ value: `${c.accountId} ${c.id}`, label: c.name })),
    ];
    const picked = await mSelect({ title: t("pim.defaultCalendar"), options });
    if (picked === null) return;
    setDefaultCalendar(picked);
    await updateMobileSettings({ defaultCalendar: picked });
  };

  /** The account this form repairs, if it is of the provider being filled in. */
  const reconnectFor = (provider: string) => (reconnect?.provider === provider ? reconnect : null);

  const connectCaldav = async () => {
    const u = url.trim();
    if (!u || !user.trim() || !pass) return;
    setBusy(true);
    try {
      const host = (() => { try { return new URL(u).host; } catch { return u; } })();
      const target = reconnectFor("caldav");
      if (target) {
        await reauthorizePimAccount(target.id, { kind: "caldav", url: u, user: user.trim(), pass });
      } else {
        await addPimAccount("caldav", label.trim() || host, { kind: "caldav", url: u, user: user.trim(), pass });
      }
      setLabel(""); setUrl(""); setUser(""); setPass(""); setReconnect(null);
      toast.success(
        target
          ? t("pim.accountReconnected", { defaultValue: "Konto neu angemeldet" })
          : t("pim.accountAdded", { defaultValue: "Konto verbunden" })
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Google/Microsoft open the system browser (OAuth); the account is added when
  // the redirect returns (handlePimOAuthRedirect -> addPimAccount -> m-pim-changed),
  // or its credential replaced in place when the flow carries an accountId.
  const connectGoogle = async () => {
    if (!gClientId.trim()) {
      toast.error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
      return;
    }
    try {
      await beginPimOAuth("google", { clientId: gClientId, clientSecret: gClientSecret, label, accountId: reconnectFor("google")?.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const connectMicrosoft = async () => {
    try {
      // Empty msClientId → beginPimOAuth uses the shipped central client id.
      await beginPimOAuth("microsoft", { clientId: msClientId, label, accountId: reconnectFor("microsoft")?.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
    const out = await reauthorizeCalendarAccount(a, {
      googleClientId: gClientId,
      googleClientSecret: gClientSecret,
      microsoftClientId: msClientId,
    });
    if (out.kind === "needsForm") {
      setAddProvider(a.provider === "caldav" ? "caldav" : "google");
      if (a.provider === "caldav") {
        setLabel(a.label);
        toast.info(t("pim.reconnectCaldavHint", { defaultValue: "Trage die Serveradresse und das Passwort unten erneut ein." }));
      } else {
        toast.error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
      }
      return;
    }
    if (out.kind === "failed") toast.error(out.error);
  };

  const remove = async (a: PimAccountRow) => {
    const ok = await mConfirm({
      title: t("pim.removeAccount", { defaultValue: "Konto entfernen" }),
      message: t("pim.removeAccountConfirm", { defaultValue: "Zugangsdaten und zwischengespeicherte Termine werden entfernt (der Kalender beim Anbieter bleibt)." }),
      confirmLabel: t("pim.removeAccount", { defaultValue: "Entfernen" }),
      danger: true,
    });
    if (!ok) return;
    try {
      await removePimAccount(a.id);
      toast.success(t("pim.accountRemoved", { defaultValue: "Konto entfernt" }));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleTaskList = async (l: { id: string; accountId: string; selected: boolean }) => {
    try {
      await setPimTaskListSelected(l.accountId, l.id, !l.selected);
      setTaskLists((ls) =>
        ls.map((x) => (x.accountId === l.accountId && x.id === l.id ? { ...x, selected: !x.selected } : x)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleCal = async (c: CalRow) => {
    try {
      await setPimCalendarSelected(c.accountId, c.id, !c.selected);
      setCalendars((cs) => cs.map((x) => (x.accountId === c.accountId && x.id === c.id ? { ...x, selected: !x.selected } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const canConnect = url.trim().length > 0 && user.trim().length > 0 && pass.length > 0 && !busy;

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("pim.accounts", { defaultValue: "Kalenderkonten" })} />
      <ConnectRunBanner service="calendar" />

      <div className="m-sync">
        {/* Per-device sign-in (package D): app settings sync, but credentials
            never do — this answers "settings synced yet no calendar login". */}
        <p className="m-hint">{t("pim.perDeviceHint")}</p>

        {/* Calendar settings (S27). Both were declared mobile gaps in the
            profile catalogue: the meeting folder decided where a meeting note
            lands, and the default calendar which calendar a new event starts
            in — settings of the VAULT and the person, not of a device, so they
            belong here and travel with the profile. */}
        <SectionLabel>{t("pim.calendarSettings")}</SectionLabel>
        <label className="m-field">
          <span>{t("pim.meetingFolder")}</span>
          <TextInput
            onBlur={() => void updateMobileSettings({ meetingFolder: meetingFolder.trim() })}
            onChange={(e) => setMeetingFolder(e.target.value)}
            placeholder="Meetings"
            value={meetingFolder}
          />
        </label>
        <GroupCard>
          <RowList>
            <Row
              end={<><span className="m-prop-val">{calendars.find((c) => `${c.accountId} ${c.id}` === defaultCalendar)?.name ?? t("pim.defaultCalendarFirst")}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickDefaultCalendar()}
              title={t("pim.defaultCalendar")}
            />
          </RowList>
        </GroupCard>

        {/* Reminders (S10) as their own section, the shape the target picture
            gives it. The remaining rows — lead time, all-day rule, tasks, which
            calendars — join in S11; the switch is here already because it is
            what asks for the notification permission. */}
        <SectionLabel>{t("reminders.section")}</SectionLabel>
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
              end={<Switch
                checked={remindTasks}
                label={t("reminders.tasks")}
                onChange={(next) => saveReminder({ remindTasks: next }, () => setRemindTasks(next))}
              />}
              title={t("reminders.tasks")}
            />
            <Row
              end={<><span className="m-prop-val">{reminderCalendars.length === 0 ? t("reminders.calendarsAll") : t("reminders.calendarsSome", { count: reminderCalendars.length, total: calendars.length })}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              onClick={() => void pickCalendars()}
              title={t("reminders.calendars")}
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("reminders.window")}</p>
        {reminderState.denied ? <Banner kind="warning" rounded>{t("reminders.denied")}</Banner> : null}
        {reminderState.truncatedFrom !== null ? (
          <Banner kind="warning" rounded>
            {t("reminders.truncated", {
              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(reminderState.truncatedFrom)),
            })}
          </Banner>
        ) : null}
        {accounts.length === 0 ? (
          <p className="m-hint">{t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}</p>
        ) : (
          accounts.map((a) => {
            const cals = calendars.filter((c) => c.accountId === a.id);
            const failure = errors.get(a.id);
            const state = accountRowState(signIn.get(a.id) ?? "active", failure);
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-row m-acct" data-testid={`pim-account-${a.id}`}>
                  <span className="m-acct-name">{a.label}</span>
                  <DeviceSignInBadge state={state} />
                  <span className="m-acct-provider">{a.provider}</span>
                  <IconButton
                    label={t("pim.removeAccount", { defaultValue: "Konto entfernen" })}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 size={ICON.ui} />
                  </IconButton>
                </div>
                {state !== "active" && (
                  /* The row alone would only say something is wrong — this says
                     what, and offers the one action that fixes it. */
                  <>
                    <p className="m-hint m-acct-hint" data-testid={`pim-account-hint-${a.id}`}>
                      {state === "expired"
                        ? a.provider === "google"
                          ? t("pim.authExpiredGoogle")
                          : t("pim.authExpired")
                        : isOAuthProvider(a.provider)
                          ? t("deviceSignIn.rowHintOauth")
                          : t("deviceSignIn.rowHintStatic")}
                    </p>
                    <Button
                      variant="tonal"
                      data-testid={`pim-account-reauth-${a.id}`}
                      onClick={() => void signInAgain(a)}
                    >
                      {t("pim.signInAgain", { defaultValue: "Neu anmelden" })}
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
                {/* The account's own rows, indented under it — the inline
                    left padding and the three hand-written ellipsis rules are
                    what the row metric is for. */}
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
                {/* Task lists (S27): the account's lists mirror into the task
                    database, and until now the phone could not say WHICH — a
                    calendar account brought all of them or none. The section
                    shows even when empty, with the reason, because a silently
                    missing section reads as "this account has no lists". */}
                <SectionLabel className="m-sectionlabel--inset">{t("pim.taskLists")}</SectionLabel>
                {taskLists.filter((l) => l.accountId === a.id).length === 0 ? (
                  <p className="m-hint m-hint--inset">{t("pim.noTaskLists")}</p>
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
              </div>
            );
          })
        )}

        {/* Was a naked <h2> with an inline font size — larger than the app-bar
            title above it. It is a section heading like every other. */}
        <SectionLabel>
          {family ? familyLabel(family) : t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}
        </SectionLabel>
        {/* Provider chooser — Google / Microsoft (OAuth) / CalDAV (app password).
            Hidden when the wizard already settled it (S0a): leaving it here was
            the silent half of the bug, because the control defaults to Google
            and arriving from the Microsoft tile looked entirely plausible. */}
        {!family && (
          <Segmented
            ariaLabel={t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}
            options={[
              { value: "google", label: "Google" },
              { value: "microsoft", label: "Microsoft" },
              { value: "caldav", label: "CalDAV" },
            ]}
            value={addProvider}
            onChange={(v) => setAddProvider(v as "google" | "microsoft" | "caldav")}
          />
        )}

        <label className="m-field">
          <span>{t("pim.accountLabel", { defaultValue: "Bezeichnung (optional)" })}</span>
          <TextInput onChange={(e) => setLabel(e.target.value)} value={label} placeholder={addProvider === "google" ? "Google" : addProvider === "microsoft" ? "Outlook" : "Fastmail"} />
        </label>

        {addProvider === "google" && (
          <>
            <p className="m-hint">{t("pim.googleByoHint", { defaultValue: "Google verlangt eine eigene OAuth-Client-ID (wie beim Drive-Sync). Scopes: Kalender + Aufgaben." })}</p>
            <label className="m-field">
              <span>Client-ID</span>
              <TextInput onChange={(e) => setGClientId(e.target.value)} value={gClientId} placeholder="…apps.googleusercontent.com" />
            </label>
            <label className="m-field">
              <span>{t("pim.googleClientSecret", { defaultValue: "Client-Secret (optional bei Desktop-Clients)" })}</span>
              <TextInput type="password" onChange={(e) => setGClientSecret(e.target.value)} value={gClientSecret} />
            </label>
            <Button
              variant="primary"
              disabled={busy || !gClientId.trim()}
              onClick={() => void connectGoogle()}
            >
              <Plus size={ICON.ui} /> {t("pim.connectGoogle", { defaultValue: "Mit Google verbinden" })}
            </Button>
          </>
        )}

        {addProvider === "microsoft" && (
          <>
            <p className="m-hint">{t("pim.microsoftHint", { defaultValue: "Nutzt die zentrale Plainva-App-Registrierung — einfach verbinden und im Browser zustimmen." })}</p>
            {!PLAINVA_ONEDRIVE_CLIENT_ID || msShowId ? (
              <label className="m-field">
                <span>Client-ID</span>
                <TextInput onChange={(e) => setMsClientId(e.target.value)} value={msClientId} />
              </label>
            ) : (
              <Button variant="ghost" onClick={() => setMsShowId(true)}>
                {t("settings.useOwnAppId", { defaultValue: "Eigene App-ID verwenden" })}
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void connectMicrosoft()}>
              <Plus size={ICON.ui} /> {t("pim.connectMicrosoft", { defaultValue: "Mit Microsoft verbinden" })}
            </Button>
          </>
        )}

        {addProvider === "caldav" && (
          <>
            <p className="m-hint">{t("pim.connectCaldavHint", { defaultValue: "CalDAV mit einem App-Passwort verbinden (z. B. Fastmail, Nextcloud, iCloud). Google/Microsoft folgen über die Anmeldung im Browser." })}</p>
            <label className="m-field">
              <span>{t("pim.caldavUrl", { defaultValue: "CalDAV-URL" })}</span>
              <TextInput onChange={(e) => setUrl(e.target.value)} value={url} placeholder="https://caldav.fastmail.com/dav/calendars/user/name/" />
            </label>
            <label className="m-field">
              <span>{t("mobile.syncUser", { defaultValue: "Benutzer" })}</span>
              <TextInput onChange={(e) => setUser(e.target.value)} value={user} />
            </label>
            <label className="m-field">
              <span>{t("mobile.syncPassword", { defaultValue: "Passwort" })}</span>
              <TextInput type="password" onChange={(e) => setPass(e.target.value)} value={pass} />
            </label>
            <Button variant="primary" disabled={!canConnect} onClick={() => void connectCaldav()}>
              <Plus size={ICON.ui} /> {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
