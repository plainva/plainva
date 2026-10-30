import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cancelOAuthLoopback } from "../../services/oauthLoopback";
import {
  Button,
  Checkbox,
  Switch,
  SearchField,
  SettingCard,
  SettingCardNote,
  SettingRow,
  TextInput,
  ICON,
  cx,
  FAMILY_SERVICES,
  CONNECT_PROVIDERS,
  nextcloudEndpoints,
  suiteProvider,
  foldMachineText,
  serviceConnectionMessage,
  WizardSteps,
  type WizardStepItem,
  toast,
  type AccessFamily,
  type AccessResolution,
  type CloudAccountRecord,
  type CloudServiceId,
  type ConnectProvider,
  type DropboxAccessResolution,
  type StoredOAuthAccess,
  OAuthAccessEditor,
  accessProblemKey,
  accessSummary,
  connectAccessPlan,
  connectFieldsComplete,
  connectPresetFor,
  plainvaGoogleClient,
  preselectedServices,
  searchConnectProviders,
  serviceUnavailableKey,
  shortClientId,
  shownConnectFields,
  SignInNothingGrantedError,
  SignInWrongAccountError,
  filesCarrier,
} from "@plainva/ui";
import {
  runConnectSequence,
  bindConnectResult,
  listSyncFoldersFromSlots,
  getSyncRootFolder,
  createSyncFolderFromSlots,
  saveSyncRootFolder,
  type ConnectRequest,
  type ConnectResult,
  type ServiceRunStatus,
} from "../../services/cloudAccountsActions";
import type { PimRuntime } from "../../services/pim/pimRuntime";
import { AccessUnavailableError, readDeviceAccess, saveDeviceAccess, deviceAccess, signInCloudAccount } from "../../services/accountSignIn";
import { loadCloudAccounts } from "../../services/cloudAccounts";
import { SyncFolderPickerModal } from "../SyncFolderPickerModal";
import { AccountMark, SERVICE_ICONS, familyLabel, serviceLabel } from "./cloudAccountsShared";
import { ConnectFieldsCard, ConnectOtherCard, ConnectSummaryCard, ServiceStatusCard, connectValue, failedServiceStatus, type ConnectValues } from "./ConnectSignInStep";

/**
 * The "Konto verbinden" flow: provider → services → sign in → set up → done,
 * for every provider the same frame (settings plan 2026-10-29, § 5). Only
 * what the access kind needs differs inside "Sign in" - the browser for
 * Google, Microsoft and Dropbox, one form for every chosen service of a
 * provider with credentials, the keys of S3 - and that comes from
 * `connectAccessPlan`, the description the phone draws too.
 */

interface WizardProps {
  vaultPath: string;
  runtime: PimRuntime | null;
  records: CloudAccountRecord[];
  onDone: (records: CloudAccountRecord[]) => void;
  onCancel: () => void;
  /** Provider id from a deep link (the start screen, a sync error) - preselects its tile. */
  initialFamily?: string;
  /** A side door (calendar, mail) ticks only its own service (E7). */
  only?: CloudServiceId;
}

/** Older deep links name the files provider, not the account's. */
const LEGACY_KEYS: Record<string, string> = { drive: "google", onedrive: "microsoft" };

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];

export const CloudAccountsWizard: React.FC<WizardProps> = ({ vaultPath, runtime, records, onDone, onCancel, initialFamily, only }) => {
  const { t } = useTranslation();
  const filesTakenBy = filesCarrier(records);
  const preselect = (provider: ConnectProvider) => preselectedServices(provider.family, { filesTaken: !!filesTakenBy, calendarAvailable: !!runtime, only });
  const preselected = initialFamily ? (CONNECT_PROVIDERS.find((p) => p.key === (LEGACY_KEYS[initialFamily] ?? initialFamily)) ?? null) : null;
  const [step, setStep] = useState<1 | 2 | 3>(preselected ? 2 : 1);
  /** Account id of the first successful bind — retries upsert the same record. */
  const boundIdRef = useRef<string | undefined>(undefined);
  const [tile, setTile] = useState<ConnectProvider | null>(preselected);
  const [svc, setSvc] = useState<Record<CloudServiceId, boolean>>(() => (preselected ? preselect(preselected) : { files: false, calendar: false, mail: false }));
  /** "Other sign-in": the same disclosure for every provider, holding what that provider has besides its standard way. */
  const [otherOpen, setOtherOpen] = useState(false);
  /** The person chose Gmail by app password under "Other sign-in". */
  const [gmailByPassword, setGmailByPassword] = useState(false);
  const [values, setValues] = useState<ConnectValues>({});
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Partial<Record<CloudServiceId, ServiceRunStatus>>>({});
  const [result, setResult] = useState<ConnectResult>({});
  const [bound, setBound] = useState<CloudAccountRecord[] | null>(null);
  const [rootFolder, setRootFolder] = useState("");
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  /**
   * Asked once, right after the files service is connected (K10): cancelling
   * the picker leaves the button as the way back; the question is not repeated.
   */
  const folderAskedRef = useRef(false);
  /** Read when the calendar step needs it: a runtime captured before a reload is a stopped one. */
  const runtimeRef = useRef(runtime);
  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);
  /** This device's access for Google, Microsoft and Dropbox (E3, E6); null while it loads. */
  const [access, setAccess] = useState<AccessResolution | DropboxAccessResolution | null>(null);
  const [storedAccess, setStoredAccess] = useState<StoredOAuthAccess | null>(null);
  /** Set when the sign-in found the account already connected in this vault. */
  const [joinedAccount, setJoinedAccount] = useState<string | null>(null);

  const family = tile?.family ?? null;
  /** Google and Microsoft sign in through the one account sign-in. */
  const accountFamily = family === "google" || family === "microsoft" ? family : null;
  const accessFamily: AccessFamily | null = accountFamily ?? (family === "dropbox" ? "dropbox" : null);
  useEffect(() => {
    if (!accessFamily) return;
    let alive = true;
    void (async () => {
      const stored = await readDeviceAccess(accessFamily, vaultPath);
      const resolved = await deviceAccess(accessFamily, vaultPath);
      if (!alive) return;
      setStoredAccess(stored);
      setAccess(resolved);
      if (!resolved.ok) setOtherOpen(true);
    })();
    return () => { alive = false; };
  }, [accessFamily, vaultPath]);
  const googleAccess = accountFamily === "google" && access?.ok && "mail" in access.access ? access.access : null;
  /** Gmail outside the consent: the access cannot carry mail, so it asks for an app password (E5). */
  const gmailNeedsPassword = family === "google" && svc.mail && !!googleAccess && !googleAccess.mail;
  /** Gmail goes by app password: because the access cannot carry mail, or because the person chose it. */
  const gmailPassword = family === "google" && svc.mail && (gmailNeedsPassword || gmailByPassword);
  const available = family ? FAMILY_SERVICES[family] : [];
  const selected = SERVICE_ORDER.filter((s) => svc[s] && available.includes(s));
  const allDone = selected.length > 0 && selected.every((s) => status[s]?.state === "ok");
  const needsFolder = !!result.filesProvider && result.filesProvider !== "webdav";
  useEffect(() => {
    if (!allDone || !needsFolder || rootFolder || folderAskedRef.current) return;
    folderAskedRef.current = true;
    setShowFolderPicker(true);
  }, [allDone, needsFolder, rootFolder]);
  const failed = selected.some((s) => status[s]?.state === "error");
  const providerName = family ? familyLabel(family, tile?.flavor) : "";
  const preset = family === "imap" ? connectPresetFor(values.mailProvider ?? "custom", values.email ?? "") : null;
  const plan = family ? connectAccessPlan({ family, flavor: tile?.flavor, services: selected, providerName, preset, gmailByPassword: gmailPassword }) : null;
  const otherShown = otherOpen || (!!accessFamily && !!access && !access.ok) || gmailNeedsPassword;
  const fields = plan ? shownConnectFields(plan, otherShown && plan.other?.holds !== "clientId" && plan.other?.holds !== "appKey") : [];

  const pickTile = (def: ConnectProvider, presetId?: string) => {
    setTile(def);
    setSvc(preselect(def));
    setOtherOpen(false);
    setGmailByPassword(false);
    setAccess(null);
    // A preset hit in the tile search jumps to the mail tile WITH the provider preselected.
    setValues(def.family === "imap" && presetId ? { mailProvider: presetId } : {});
    setStatus({});
    setStep(2);
  };

  const field = (id: keyof ConnectValues) => {
    const entry = fields.find((f) => f.id === id) ?? plan?.other?.fields.find((f) => f.id === id) ?? plan?.fields.find((f) => f.id === id);
    return (entry ? connectValue(values, entry) : (values[id] ?? "")).trim();
  };
  /** Addresses as a machine reads them (lib/machineText.ts): a keyboard set to Japanese or Chinese types full-width forms no server answers to. */
  const address = (id: keyof ConnectValues) => foldMachineText(field(id));

  const buildRequest = (services: CloudServiceId[]): ConnectRequest => {
    const endpointsOpen = otherShown && plan?.other?.holds === "endpoints";
    const suite = family ? suiteProvider(family) : null;
    const secret = values.secret ?? "";
    let webdav: ConnectRequest["webdav"];
    if (family === "webdav" && tile?.flavor === "nextcloud" && !endpointsOpen) {
      const derived = nextcloudEndpoints(address("server"), field("user")) ?? { files: "", caldav: "" };
      webdav = { filesUrl: derived.files, caldavUrl: derived.caldav, user: field("user"), pass: secret };
    } else if (family === "webdav") {
      webdav = { filesUrl: address("filesUrl"), caldavUrl: address("caldavUrl"), user: field("user"), pass: secret };
    } else if (suite) {
      // Suites reuse the WebDAV (files + calendar) and IMAP (mail) shapes - one credential, endpoints from the catalog unless opened.
      webdav = { filesUrl: endpointsOpen ? address("filesUrl") : (suite.endpoints.webdavUrl ?? ""), caldavUrl: endpointsOpen ? address("caldavUrl") : (suite.endpoints.caldavUrl ?? ""), user: field("email"), pass: secret };
    }
    const mailByForm = family === "imap" || (family === "google" && services.includes("mail")) || (!!suite && services.includes("mail"));
    const imap: ConnectRequest["imap"] = mailByForm
      ? suite && !endpointsOpen
        ? { email: field("email"), host: suite.endpoints.imapHost ?? "", port: suite.endpoints.imapPort ?? 993, smtpHost: suite.endpoints.smtpHost, smtpPort: suite.endpoints.smtpPort, pass: secret }
        : {
            email: field("email"),
            host: family === "google" ? "imap.gmail.com" : address("imapHost"),
            port: family === "google" ? 993 : Number(field("imapPort")) || 993,
            smtpHost: family === "google" ? "smtp.gmail.com" : address("smtpHost") || undefined,
            smtpPort: family === "google" ? 587 : Number(field("smtpPort")) || undefined,
            pass: secret,
          }
      : undefined;
    return {
      family: family!,
      flavor: tile?.flavor,
      services,
      ...(family === "dropbox" && access?.ok ? { dropboxAppKey: access.access.clientId } : {}),
      webdav,
      s3:
        family === "s3"
          ? {
              endpoint: address("endpoint"),
              region: address("region") || "us-east-1",
              bucket: address("bucket"),
              accessKeyId: address("accessKeyId"),
              secretAccessKey: secret,
              prefix: field("prefix") || undefined,
              forcePathStyle: field("pathStyle") !== "off",
            }
          : undefined,
      imap,
    };
  };

  const failedStatus = (err: unknown): ServiceRunStatus => failedServiceStatus(err, t, providerName);
  const signInText = (err: unknown): string => {
    if (err instanceof SignInWrongAccountError) return t("cloudAccounts.wrongAccount", { expected: err.expected, actual: err.actual });
    if (err instanceof SignInNothingGrantedError) return t("cloudAccounts.nothingGranted");
    if (err instanceof AccessUnavailableError) return t(accessProblemKey(err.problem));
    return failedStatus(err).detail ?? "";
  };

  /**
   * Google and Microsoft: ONE consent for every ticked service, then each
   * service says its own result - a service the provider left unticked says
   * so instead of the run stopping at the first one (finding 2026-10-23).
   */
  const runSignIn = async (todo: CloudServiceId[]) => {
    setRunning(true);
    setStatus((prev) => ({ ...prev, ...Object.fromEntries(todo.map((s) => [s, { state: "pending" } as ServiceRunStatus])) }));
    try {
      const outcome = await signInCloudAccount(vaultPath, () => runtimeRef.current, {
        family: accountFamily!,
        ...(boundIdRef.current ? { cardId: boundIdRef.current } : {}),
        add: todo,
        ...(gmailPassword && todo.includes("mail") ? { mailPassword: { email: field("email"), pass: values.secret ?? "" } } : {}),
      });
      boundIdRef.current = outcome.record.id;
      if (outcome.completed?.joinedExistingCard) setJoinedAccount(outcome.record.label);
      const next: Partial<Record<CloudServiceId, ServiceRunStatus>> = {};
      for (const row of outcome.rows) {
        next[row.service] = row.state === "active"
          ? { state: "ok" }
          : row.state === "notGranted"
            ? { state: "error", reason: "permissions", title: t("connectRun.notCompleted"), detail: t("cloudAccounts.notGranted") }
            : row.state === "needsPassword"
              ? { state: "error", title: t("connectRun.notCompleted"), detail: t("cloudAccounts.needsAppPassword") }
              // The failure itself says who it came from; a row with only its
              // sentence keeps that sentence, never reread as the provider's words.
              : "error" in row ? failedStatus(row.error) : { state: "error", title: t("connectRun.notCompleted"), detail: row.detail };
      }
      setStatus((prev) => ({ ...prev, ...next }));
      const services = outcome.record.services;
      setResult({ filesProvider: services.files?.provider, pimAccountId: services.calendar?.pimAccountId, mailAccountId: services.mail?.mailAccountId, accountId: outcome.record.id });
      setBound(await loadCloudAccounts(vaultPath));
      if (services.files && services.files.provider !== "webdav") setRootFolder(await getSyncRootFolder(vaultPath, services.files.provider));
      const calendarId = services.calendar?.pimAccountId;
      if (next.calendar?.state === "ok" && calendarId && runtimeRef.current) {
        const cals = await runtimeRef.current.cache.listCalendars(calendarId);
        setStatus((prev) => ({ ...prev, calendar: { state: "ok", detail: t("cloudAccounts.calendarsFound", { count: cals.length }) } }));
      }
    } catch (err) {
      const failure = err instanceof AccessUnavailableError || err instanceof SignInWrongAccountError || err instanceof SignInNothingGrantedError
        ? { state: "error" as const, title: t("connectRun.notCompleted"), detail: signInText(err) }
        : failedStatus(err);
      setStatus((prev) => ({ ...prev, ...Object.fromEntries(todo.map((s) => [s, failure as ServiceRunStatus])) }));
    } finally {
      setRunning(false);
    }
  };

  /**
   * Every other provider: each chosen service connects on its own and says
   * its own result - a calendar the server turns away no longer stops the
   * mailbox after it (settings plan § 5.1, step 4).
   */
  const run = async () => {
    // Retry semantics: only services that are not OK yet run (again).
    const todo = selected.filter((s) => status[s]?.state !== "ok");
    if (todo.length === 0) return;
    if (accountFamily) return runSignIn(todo);
    setRunning(true);
    const merged: ConnectResult = { ...result };
    try {
      const req = buildRequest(todo);
      const res = await runConnectSequence(vaultPath, runtime, req, (service, st) =>
        setStatus((prev) => ({ ...prev, [service]: st.state === "error" && st.cause !== undefined ? failedStatus(st.cause) : st })),
      );
      Object.assign(merged, res);
    } catch (err) {
      // A request the run could not start: every service it held says why.
      setStatus((prev) => ({ ...prev, ...Object.fromEntries(todo.map((s) => [s, failedStatus(err)])) }));
    }
    setResult(merged);
    // Bind whatever connected — a half-finished wizard must not lose services.
    if (merged.filesProvider || merged.pimAccountId || merged.mailAccountId) {
      try {
        // Retries keep upserting the SAME record (finding #1: a fresh bind
        // per attempt minted duplicate accounts over the bound services).
        const { records: next, accountId } = await bindConnectResult(vaultPath, runtime, buildRequest(selected), merged, boundIdRef.current);
        boundIdRef.current = accountId;
        setBound(next);
        if (merged.filesProvider && merged.filesProvider !== "webdav") setRootFolder(await getSyncRootFolder(vaultPath, merged.filesProvider));
        if (merged.pimAccountId && runtime) {
          const cals = await runtime.cache.listCalendars(merged.pimAccountId);
          setStatus((prev) => (prev.calendar?.state === "ok" ? { ...prev, calendar: { state: "ok", detail: t("cloudAccounts.calendarsFound", { count: cals.length }) } } : prev));
        }
      } catch (err) {
        // Storing the account failed after its services connected: every one of them says so, with the sender.
        setStatus((prev) => ({ ...prev, ...Object.fromEntries(todo.filter((s) => prev[s]?.state === "ok").map((s) => [s, failedStatus(err)])) }));
      }
    }
    setRunning(false);
  };

  const finish = () => {
    if (bound) onDone(bound);
    else onCancel();
  };

  // The steps of the whole way, as the phone's setup draws them: provider,
  // services, sign in, set up (the folder), done.
  const setUpDone = allDone && (!needsFolder || !!rootFolder);
  const stepState = (n: 1 | 2 | 3 | 4 | 5): WizardStepItem["state"] => {
    if (n <= 2) return step > n ? "done" : step === n ? "active" : "pending";
    if (n === 3) return allDone ? "done" : step === 3 ? "active" : "pending";
    if (n === 4) return setUpDone ? "done" : allDone ? "active" : "pending";
    return setUpDone ? "active" : "pending";
  };
  const steps = (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <WizardSteps
        label={t("connectRun.stepsLabel")}
        steps={[
          { key: "provider", label: tile ? familyLabel(tile.family, tile.flavor) : t("cloudAccounts.stepProvider"), state: stepState(1) },
          { key: "services", label: t("cloudAccounts.stepServices"), state: stepState(2) },
          { key: "signin", label: t("cloudAccounts.stepSignIn"), state: stepState(3) },
          { key: "setup", label: t("connectAccess.stepSetUp"), state: stepState(4) },
          { key: "done", label: t("cloudAccounts.finish"), state: stepState(5) },
        ]}
      />
    </div>
  );

  /* ---------- step 1: provider tiles ---------- */
  if (step === 1) {
    const { visible, presetHit, presetKey } = searchConnectProviders(query, (p) => familyLabel(p.family, p.flavor));
    return (
      <div>
        {steps}
        <SearchField
          value={query}
          onValueChange={setQuery}
          clearLabel={t("sidebar.clearSearch")}
          placeholder={t("cloudAccounts.searchProviders")}
          aria-label={t("cloudAccounts.searchProviders")}
          data-testid="cloudacct-tile-search"
          className="pv-provtile-search"
        />
        <div className="pv-provtile-grid">
          {visible.map((def) => (
            <button
              key={def.key}
              type="button"
              className={cx("pv-provtile", tile?.key === def.key && "is-active")}
              onClick={() => pickTile(def, def.key === "imap" && presetHit && !presetHit.useTileInstead ? presetHit.id : undefined)}
              data-testid={`cloudacct-provider-${def.key}`}
            >
              <AccountMark family={def.family} flavor={def.flavor} small />
              <span className="pv-provtile-name">{familyLabel(def.family, def.flavor)}</span>
              {def.key === presetKey && presetHit && <span className="pv-provtile-hint">{presetHit.label}</span>}
              <span className="pv-provtile-caps">
                {FAMILY_SERVICES[def.family].map((s) => {
                  const Icon = SERVICE_ICONS[s];
                  return <Icon key={s} size={ICON.meta} />;
                })}
              </span>
            </button>
          ))}
        </div>
        {visible.length === 0 && <SettingCardNote>{t("cloudAccounts.searchNoProvider")}</SettingCardNote>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- step 2: service selection ---------- */
  if (step === 2 && family) {
    return (
      <div>
        {steps}
        <SettingCard>
          {SERVICE_ORDER.map((service) => {
            const Icon = SERVICE_ICONS[service];
            // What the provider cannot carry stays in the list, off, with the reason (§ 5.1, step 2).
            const unavailable = serviceUnavailableKey(family, service);
            const takenByOther = service === "files" && !unavailable && !!filesTakenBy;
            const needsRuntime = service === "calendar" && !unavailable && !runtime;
            const disabled = !!unavailable || takenByOther || needsRuntime;
            return (
              <div key={service} className={cx("pv-svcline", disabled && "is-off")} data-testid={`cloudacct-svcline-${service}`}>
                <span className="pv-svcline-icon">
                  <Icon size={ICON.ui} />
                </span>
                <div className="pv-svcline-main">
                  <div className="pv-svcline-title">
                    {serviceLabel(service)}
                    {takenByOther && (
                      <span className="pv-svcchip pv-svcchip--off">
                        {t("cloudAccounts.filesTaken", { account: filesTakenBy!.label || familyLabel(filesTakenBy!.family, filesTakenBy!.flavor) })}
                      </span>
                    )}
                    {service === "mail" && gmailNeedsPassword && <span className="pv-svcchip pv-svcchip--off">{t("cloudAccounts.appPasswordBadge")}</span>}
                  </div>
                  <div className="pv-svcline-desc">
                    {unavailable
                      ? t(unavailable, { provider: providerName })
                      : takenByOther
                        ? t("cloudAccounts.filesTakenDetail", { account: filesTakenBy!.label || familyLabel(filesTakenBy!.family, filesTakenBy!.flavor) })
                        : needsRuntime
                          ? t("pim.openVaultFirst")
                          : service === "files"
                            ? t("cloudAccounts.svcFilesDesc")
                            : service === "calendar"
                              ? t("cloudAccounts.svcCalendarDesc")
                              : t("cloudAccounts.svcMailDesc")}
                  </div>
                </div>
                <div className="pv-svcline-ctrl">
                  <Checkbox
                    checked={!unavailable && svc[service]}
                    disabled={disabled}
                    onChange={(e) => setSvc((prev) => ({ ...prev, [service]: e.target.checked }))}
                    aria-label={serviceLabel(service)}
                    data-testid={`cloudacct-svc-${service}`}
                  />
                </div>
              </div>
            );
          })}
          <SettingCardNote>{t("cloudAccounts.servicesHint")}</SettingCardNote>
        </SettingCard>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={() => setStep(1)}>
            {t("cloudAccounts.back")}
          </Button>
          <Button variant="primary" disabled={selected.length === 0} onClick={() => setStep(3)} data-testid="cloudacct-to-signin">
            {t("cloudAccounts.stepSignIn")}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- step 3: sign in, set up, done ---------- */
  if (!plan || !family) return null;
  const oauthKind = plan.kind === "oauthDevice" || plan.kind === "oauthAppKey";
  const headText = oauthKind
    ? access
      ? accessSummary(plan, access.ok ? { ok: true, source: access.access.source, id: shortClientId(access.access.clientId) } : { ok: false, problemKey: accessProblemKey(access.problem) })
      : null
    : plan.summary;
  const headLine = headText ? t(headText.key, headText.values) : "";
  const connectDisabled = running || (oauthKind && !access?.ok) || !connectFieldsComplete(fields, values) || !!plan.useTileInstead;
  const setValue = (id: keyof ConnectValues, value: string) => setValues((prev) => ({ ...prev, [id]: value }));

  return (
    <div>
      {steps}
      <ConnectSummaryCard family={family} flavor={tile?.flavor} services={selected} line={headLine} />
      <ConnectFieldsCard
        plan={plan}
        fields={fields}
        values={values}
        onChange={setValue}
        disabled={running || allDone}
        onUseTile={(target) => { const def = CONNECT_PROVIDERS.find((p) => p.family === target); if (def) pickTile(def); }}
      />
      {!allDone && <ConnectOtherCard plan={plan} open={otherShown} disabled={running} onToggle={() => setOtherOpen(!otherShown)} />}
      {!allDone && otherShown && accessFamily && access && (
        // Its own card, never one inside "Other sign-in" (a card holds rows).
        <OAuthAccessEditor
          family={accessFamily}
          platform="desktop"
          value={storedAccess}
          plainvaAvailable={accessFamily !== "google" || !!plainvaGoogleClient(import.meta.env as unknown as Record<string, unknown>, "desktop")}
          onSave={async (next) => {
            await saveDeviceAccess(accessFamily, next);
            setStoredAccess(next);
            const resolved = await deviceAccess(accessFamily, vaultPath);
            setAccess(resolved);
            if (resolved.ok) setOtherOpen(false);
          }}
          onCancel={access.ok ? () => setOtherOpen(false) : undefined}
        />
      )}
      {!allDone && otherShown && family === "google" && svc.mail && (
        <SettingCard>
          <SettingRow label={t("cloudAccounts.mailByAppPassword")} desc={t("cloudAccounts.mailByAppPasswordHint")}>
            <Switch
              checked={gmailPassword}
              disabled={gmailNeedsPassword || running}
              label={t("cloudAccounts.mailByAppPassword")}
              onChange={setGmailByPassword}
              testId="cloudacct-gmail-by-password"
            />
          </SettingRow>
        </SettingCard>
      )}

      <ServiceStatusCard services={selected} status={status} waitingKey={plan.waitingKey}>
        {allDone && result.filesProvider === "webdav" && <SettingCardNote>{t("cloudAccounts.cloudFolderInUrl")}</SettingCardNote>}
        {allDone && needsFolder && (
          <SettingRow label={t("cloudAccounts.cloudFolder")} desc={t("cloudAccounts.cloudFolderHint")}>
            <TextInput value={rootFolder} readOnly style={{ width: 160 }} />
            <Button variant="secondary" onClick={() => setShowFolderPicker(true)} data-testid="cloudacct-choose-folder">
              {t("connectRun.chooseFolder")}
            </Button>
          </SettingRow>
        )}
        {allDone && svc.calendar && <SettingCardNote>{t("cloudAccounts.calendarNext")}</SettingCardNote>}
        {joinedAccount && <SettingCardNote><span data-testid="cloudacct-joined">{t("cloudAccounts.joinedExisting", { account: joinedAccount })}</span></SettingCardNote>}
      </ServiceStatusCard>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        {/* A running consent can be abandoned in the browser; without this the
            wizard sat on "connecting" for three minutes with no way out
            (N1/S1). Aborting the wait is what "back" means while it runs. */}
        {!allDone && (
          <Button variant="ghost" onClick={running && oauthKind ? () => void cancelOAuthLoopback() : () => setStep(2)} disabled={running && !oauthKind}>
            {running && oauthKind ? t("common.cancel") : t("cloudAccounts.back")}
          </Button>
        )}
        {!allDone && (
          <Button variant="primary" disabled={connectDisabled} onClick={() => void run()} data-testid="cloudacct-connect">
            {running ? t("pim.connecting") : failed ? t("cloudAccounts.retry") : t(plan.button.key, plan.button.values)}
          </Button>
        )}
        {allDone && (
          <Button variant="primary" onClick={finish} data-testid="cloudacct-finish">
            {t("cloudAccounts.finish")}
          </Button>
        )}
      </div>

      {showFolderPicker && result.filesProvider && (
        <SyncFolderPickerModal
          listFolders={(p) => listSyncFoldersFromSlots(vaultPath, result.filesProvider!, p)}
          createFolder={(p) => createSyncFolderFromSlots(vaultPath, result.filesProvider!, p)}
          rootLabel={providerName}
          allowRoot={result.filesProvider === "s3"}
          onSelect={(picked) => {
            setShowFolderPicker(false);
            // A pick that is not stored says so, as on the phone (device finding 2026-10-27).
            void saveSyncRootFolder(vaultPath, result.filesProvider!, picked)
              .then(() => getSyncRootFolder(vaultPath, result.filesProvider!).then(setRootFolder))
              .catch((error: unknown) => toast.error(serviceConnectionMessage(error, t)));
          }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
};
