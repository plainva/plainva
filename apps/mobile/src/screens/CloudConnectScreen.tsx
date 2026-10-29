import { useEffect, useState } from "react";
import { isDevicePimSupported } from "../platform/devicePim";
import { hasDevicePimAccount } from "../services/pim/pimService";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Folder, Mail } from "lucide-react";
import {
  accountMonogram,
  accessProblemKey,
  accessSummary,
  Button,
  Checkbox,
  CONNECT_PROVIDERS,
  connectAccessPlan,
  connectFieldsComplete,
  connectPresetFor,
  FAMILY_SERVICES,
  familyLabel,
  filesCarrier,
  getPlatformServices,
  GroupCard,
  ICON,
  isInsecurePublicUrl,
  Banner,
  MAIL_PRESETS,
  preselectedServices,
  searchConnectProviders,
  Row,
  RowList,
  SearchField,
  serviceConnectionFailure,
  serviceLabel,
  serviceUnavailableKey,
  SettingField,
  shortClientId,
  shownConnectFields,
  Switch,
  TextInput,
  WizardSteps,
  type AccessFamily,
  type AccessResolution,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
  type ConnectField,
  type ConnectProvider,
  type DropboxAccessResolution,
  type WizardStepItem,
} from "@plainva/ui";
import { loadCloudAccounts } from "../services/cloudAccountsStore";
import { AppBar } from "../components/AppBar";
import { AccountAccessSheet } from "../components/AccountAccessSheet";
import { AccessUnavailableError, beginMobileSignIn, deviceAccess, dropboxDeviceKey } from "../services/accountSignIn";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { mSelect } from "../services/mobileDialogs";
import { loadConnectQueue, startConnectQueue } from "../services/connectQueue";
import { rememberConnectSecrets } from "../services/connectSecrets";
import { phoneConnectRequest, type ConnectFormValues } from "../services/connectForm";
import { phoneProbePorts, probeConnectServices, type ProbeState } from "../services/connectProbe";
import { useLeaveGuard } from "../hooks/useLeaveGuard";

/**
 * Connecting an account: provider › services › sign in › set up › done, the
 * same frame as the desktop wizard and for every provider (settings plan
 * 2026-10-29, § 5). The provider list, the search over it, the preselected
 * services and the sign-in step are the shared description
 * (`connectAccessPlan`); only what the access kind needs differs:
 *
 *  - Google, Microsoft and Dropbox sign in through the browser from the
 *    services page, its button naming the provider;
 *  - a provider with credentials (the suites, WebDAV, Nextcloud, IMAP) and S3
 *    ask on ONE sign-in page for every chosen service (E5) - each service
 *    tries the credential and says its own result, and the run then sets the
 *    services up without asking again;
 *  - the phone's own calendars ask the system.
 *
 * A side door (a new vault in the cloud, the calendar's "Add account…", the
 * mail's "Add mailbox") opens this screen with its service ticked (E7).
 */

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];
const SERVICE_ICON = { files: Folder, calendar: CalendarDays, mail: Mail } as const;

type Stage = "services" | "signin";

export function CloudConnectScreen({
  onBack,
  onOpenStep,
  onConnectDevice,
  only,
  createTemplateId,
}: {
  onBack: () => void;
  /** The device's own calendars (EventKit plan E5): one tap asks the system, no form. */
  onConnectDevice?: () => void;
  /** The run has started: open the screen of its first step. */
  onOpenStep: (service: CloudServiceId, family: CloudProviderFamily) => void;
  /** A side door ticks only its own service (E7). */
  only?: CloudServiceId;
  /** The "new vault in the cloud" door: the files step scaffolds this template. */
  createTemplateId?: string;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<ConnectProvider | null>(null);
  const [device, setDevice] = useState(false);
  const [stage, setStage] = useState<Stage>("services");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CloudServiceId[]>([]);
  /** Google/Microsoft/Dropbox without a usable access on this phone: the sheet asks for it. */
  const [accessFor, setAccessFor] = useState<AccessFamily | null>(null);
  /** "Other sign-in": the sheet of the browser kinds, the folded fields of the others. */
  const [otherOpen, setOtherOpen] = useState(false);
  const [gmailByPassword, setGmailByPassword] = useState(false);
  const [starting, setStarting] = useState(false);
  const [values, setValues] = useState<ConnectFormValues>({});
  const [probe, setProbe] = useState<Partial<Record<CloudServiceId, ProbeState>>>({});
  /** A failure of the step itself, with its sender (no bare toast). */
  const [failure, setFailure] = useState<unknown>(null);
  const [access, setAccess] = useState<AccessResolution | DropboxAccessResolution | null>(null);
  // The device tile exists only on the native shells and only while no device
  // account exists (E7): the device is the source, not a login — one per phone.
  const [deviceTile, setDeviceTile] = useState(false);
  useEffect(() => {
    if (!isDevicePimSupported() || !onConnectDevice || (only && only !== "calendar")) return;
    let alive = true;
    void hasDevicePimAccount().then((has) => { if (alive) setDeviceTile(!has); });
    return () => { alive = false; };
  }, [onConnectDevice, only]);
  // Files go through one account per vault: while one carries them, they are offered off, named.
  const [filesTakenBy, setFilesTakenBy] = useState<CloudAccountRecord | undefined>();
  useEffect(() => {
    let alive = true;
    void getActiveVaultEntry()
      .then((entry) => loadCloudAccounts(entry.id))
      .then((records) => { if (alive) setFilesTakenBy(filesCarrier(records)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const family = provider?.family ?? null;
  const accessFamily: AccessFamily | null = family === "google" || family === "microsoft" || family === "dropbox" ? family : null;
  useEffect(() => {
    if (!accessFamily) { setAccess(null); return; }
    let alive = true;
    void getActiveVaultEntry()
      .then((entry) => deviceAccess(accessFamily, entry.id))
      .then((resolved) => { if (alive) setAccess(resolved); })
      .catch(() => {});
    return () => { alive = false; };
  }, [accessFamily, accessFor]);
  // Credentials typed here are not stored until the sign-in: a tap on the bar must not drop them in silence.
  useLeaveGuard("cloud-connect", Object.values(values).some((value) => !!value && value !== "off"), t("mobile.leaveCredentials"));

  const providerName = provider ? familyLabel(provider.family, provider.flavor) : "";
  const chosen = SERVICE_ORDER.filter((service) => picked.includes(service) && !!family && FAMILY_SERVICES[family].includes(service));
  const googleAccess = family === "google" && access?.ok && "mail" in access.access ? access.access : null;
  const gmailPassword = family === "google" && chosen.includes("mail") && (gmailByPassword || (!!googleAccess && !googleAccess.mail));
  const preset = family === "imap" ? connectPresetFor(values.mailProvider ?? "custom", values.email ?? "") : null;
  const plan = family ? connectAccessPlan({ family, flavor: provider?.flavor, services: chosen, providerName, preset, gmailByPassword: gmailPassword }) : null;
  const formKind = plan?.kind === "credentials" || plan?.kind === "keys";
  const fields = plan ? shownConnectFields(plan, otherOpen && formKind) : [];

  const pick = (next: ConnectProvider, presetId?: string) => {
    setProvider(next);
    setStage("services");
    setPicked(SERVICE_ORDER.filter((service) => preselectedServices(next.family, { filesTaken: !!filesTakenBy, calendarAvailable: true, only })[service]));
    setGmailByPassword(false);
    setOtherOpen(false);
    setValues(presetId ? { mailProvider: presetId } : {});
    setProbe({});
    setFailure(null);
  };

  const steps = (signInState: WizardStepItem["state"]) => (
    <WizardSteps
      layout="stacked"
      label={t("connectRun.stepsLabel")}
      testId="connect-steps"
      steps={[
        { key: "provider", label: provider ? providerName : t("cloudAccounts.stepProvider"), state: provider || device ? "done" : "active" },
        { key: "services", label: t("cloudAccounts.stepServices"), state: !provider && !device ? "pending" : stage === "services" ? "active" : "done" },
        { key: "signin", label: t("cloudAccounts.stepSignIn"), state: signInState },
        { key: "setup", label: t("connectAccess.stepSetUp"), state: "pending" },
        { key: "done", label: t("cloudAccounts.finish"), state: "pending" },
      ]}
    />
  );

  /** The run of the chosen services has begun: its first step opens. */
  const openRun = async (services: CloudServiceId[], options: Parameters<typeof startConnectQueue>[3]) => {
    const first = await startConnectQueue(family!, services, undefined, { ...options, ...(provider?.flavor ? { flavor: provider.flavor } : {}), ...(createTemplateId !== undefined ? { createTemplateId } : {}) });
    if (first) onOpenStep(first, family!);
  };

  /** Google and Microsoft: the one sign-in for every chosen service, in the browser. */
  const signInAccount = async () => {
    if (family !== "google" && family !== "microsoft") return;
    if (filesTakenBy && chosen.includes("files")) return;
    // Gmail by app password goes outside the consent and on to the mail screen, bound to the card (E5).
    const outside: CloudServiceId[] = gmailPassword ? ["mail"] : [];
    const out = await beginMobileSignIn((await getActiveVaultEntry()).id, { family, add: chosen, ...(outside.length ? { outside } : {}) });
    // Only an app-password mailbox was ticked: no consent, the mail screen asks.
    if (out.kind === "nothingToAsk") await openRun(chosen, {});
  };

  /** Dropbox: the run starts before its sign-in, and the sign-in opens at once - not hidden in the folder step. */
  const signInDropbox = async () => {
    const vaultId = (await getActiveVaultEntry()).id;
    const appKey = await dropboxDeviceKey(vaultId);
    await openRun(["files"], { signedIn: false });
    const run = await loadConnectQueue();
    const { beginOAuth } = await import("../services/oauthService");
    await beginOAuth("dropbox", { clientId: appKey, ...(run ? { serviceContext: run.context } : {}), ...(createTemplateId !== undefined ? { createTemplateId } : {}) });
  };

  const start = async () => {
    if (!plan || !family) return;
    setStarting(true);
    setFailure(null);
    try {
      if (plan.kind === "oauthDevice") await signInAccount();
      else if (plan.kind === "oauthAppKey") await signInDropbox();
      else setStage("signin");
    } catch (error) {
      if (error instanceof AccessUnavailableError) setAccessFor(error.family);
      else setFailure(error);
    } finally {
      setStarting(false);
    }
  };

  /**
   * The one form: every chosen service tries the credential on its own server
   * and says its result; a failure does not stop the others. Once every
   * service could sign in, the run sets them up without asking again.
   */
  const signInWithForm = async (continueWithout = false) => {
    if (!plan || !family) return;
    const request = phoneConnectRequest({ family, flavor: provider?.flavor, services: chosen, plan, values, otherOpen });
    const ok = chosen.filter((service) => probe[service]?.state === "ok");
    if (continueWithout) {
      await finishSignIn(request, ok, chosen.filter((service) => !ok.includes(service)));
      return;
    }
    setStarting(true);
    setFailure(null);
    try {
      const todo = chosen.filter((service) => probe[service]?.state !== "ok");
      const result = await probeConnectServices(request, todo, await phoneProbePorts(), (service, state) => setProbe((prev) => ({ ...prev, [service]: state })));
      if (result.failed.length === 0) await finishSignIn(request, [...ok, ...result.ok], []);
    } catch (error) {
      setFailure(error);
    } finally {
      setStarting(false);
    }
  };

  const finishSignIn = async (request: ReturnType<typeof phoneConnectRequest>, ok: CloudServiceId[], skipped: CloudServiceId[]) => {
    if (ok.length === 0) return;
    // In memory only, for this run's steps (E4): never on the disk.
    const user = request.files?.provider === "webdav" ? request.files.creds.user : request.caldav?.user ?? request.imap?.email;
    rememberConnectSecrets({
      request,
      ...(request.files?.provider === "webdav" ? { baseUrl: request.files.creds.url } : {}),
      ...(user ? { user } : {}),
      ...(request.imap ? { email: request.imap.email } : {}),
      ...(values.secret ? { password: values.secret } : {}),
    });
    await openRun(chosen, { signedIn: true, skipped });
  };

  /* ---------- provider ---------- */
  if (!provider && !device) {
    const offered = CONNECT_PROVIDERS.filter((entry) => !only || FAMILY_SERVICES[entry.family].includes(only));
    const { visible, presetHit, presetKey } = searchConnectProviders(query, (entry) => familyLabel(entry.family, entry.flavor), offered);
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("cloudAccounts.addAccount")} />
        <div className="m-settings">
          {steps("pending")}
          <p className="m-hint">{t("cloudAccounts.pickProvider")}</p>
          <SearchField
            value={query}
            onValueChange={setQuery}
            clearLabel={t("sidebar.clearSearch")}
            placeholder={t("cloudAccounts.searchProviders")}
            aria-label={t("cloudAccounts.searchProviders")}
            data-testid="connect-search"
          />
          <GroupCard>
            <RowList>
              {deviceTile && !query.trim() && (
                <Row
                  data-testid="connect-family-device"
                  end={<ChevronRight className="m-chevron" size={ICON.head} />}
                  icon={<span aria-hidden className="m-acctmark m-acctmark--device">{accountMonogram("device")}</span>}
                  onClick={() => setDevice(true)}
                  subtitle={serviceLabel("calendar")}
                  title={t("cloudAccounts.familyDevice")}
                />
              )}
              {visible.map((entry) => (
                <Row
                  data-testid={`connect-family-${entry.key}`}
                  end={<ChevronRight className="m-chevron" size={ICON.head} />}
                  icon={<span aria-hidden className={`m-acctmark m-acctmark--${entry.family}`}>{accountMonogram(entry.family, entry.flavor)}</span>}
                  key={entry.key}
                  onClick={() => pick(entry, entry.key === "imap" && presetHit && !presetHit.useTileInstead ? presetHit.id : undefined)}
                  subtitle={entry.key === presetKey && presetHit ? presetHit.label : FAMILY_SERVICES[entry.family].map(serviceLabel).join(" · ")}
                  title={familyLabel(entry.family, entry.flavor)}
                />
              ))}
            </RowList>
          </GroupCard>
          {visible.length === 0 && <p className="m-hint">{t("cloudAccounts.searchNoProvider")}</p>}
        </div>
      </div>
    );
  }

  /* ---------- the phone's own calendars: the system asks ---------- */
  if (device) {
    const devicePlan = connectAccessPlan({ family: "device", services: ["calendar"], providerName: t("cloudAccounts.familyDevice") });
    return (
      <div className="m-page">
        <AppBar onBack={() => setDevice(false)} title={t("cloudAccounts.familyDevice")} />
        <div className="m-settings">
          {steps("active")}
          <p className="m-hint" data-testid="connect-summary">{t(devicePlan.summary.key)}</p>
          <Button variant="primary" data-testid="connect-start" onClick={() => onConnectDevice?.()}>{t(devicePlan.button.key)}</Button>
        </div>
      </div>
    );
  }

  if (!plan || !family || !provider) return null;
  const headText = plan.kind === "oauthDevice" || plan.kind === "oauthAppKey"
    ? access
      ? accessSummary(plan, access.ok ? { ok: true, source: access.access.source, id: shortClientId(access.access.clientId) } : { ok: false, problemKey: accessProblemKey(access.problem) })
      : null
    : plan.summary;
  const head = (
    <GroupCard>
      <RowList>
        <Row
          data-testid="connect-summary"
          icon={<span aria-hidden className={`m-acctmark m-acctmark--${family}`}>{accountMonogram(family, provider.flavor)}</span>}
          title={chosen.map(serviceLabel).join(" · ") || providerName}
          subtitle={headText ? t(headText.key, headText.values) : undefined}
          wrap
        />
      </RowList>
    </GroupCard>
  );
  const failureView = failure ? serviceConnectionFailure(failure, t, { provider: providerName }) : null;
  const failureNote = failureView && (
    <Banner kind="error" rounded>
      <span data-testid="connect-failure" className="m-connectrun-note-text">
        {failureView.title && <strong>{failureView.title}</strong>}
        <span>{failureView.text}</span>
        {failureView.raw && <code className="m-connectrun-raw">{failureView.raw}</code>}
      </span>
    </Banner>
  );

  /* ---------- sign in with credentials or keys: one form for every chosen service ---------- */
  if (stage === "signin" && formKind) {
    const failed = chosen.filter((service) => probe[service]?.state === "error");
    const passed = chosen.filter((service) => probe[service]?.state === "ok");
    const running = chosen.some((service) => probe[service]?.state === "pending") || starting;
    const insecure = fields.some((field) => field.input === "address" && isInsecurePublicUrl(values[field.id] ?? field.prefill ?? ""));
    return (
      <div className="m-page">
        <AppBar onBack={() => setStage("services")} title={providerName} />
        <div className="m-settings">
          {steps("active")}
          {head}
          {insecure && <Banner kind="warning" rounded>{t("settings.insecureUrlWarning")}</Banner>}
          <ConnectForm fields={fields} values={values} disabled={running} onChange={(id, value) => {
            // The address names the mail provider anew, as on the desktop: a GMX choice does not hold an Outlook address.
            setValues((prev) => ({ ...prev, [id]: value, ...(family === "imap" && id === "email" ? { mailProvider: "custom" } : {}) }));
            setProbe({});
          }} />
          {plan.notes.map((note) => (
            <p className="m-hint" key={note.key} data-testid="connect-note">
              {t(note.key, note.values)}
              {plan.useTileInstead && note.key === "cloudAccounts.presetUseMicrosoft" && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" data-testid="connect-open-microsoft" onClick={() => pick(CONNECT_PROVIDERS.find((entry) => entry.family === plan.useTileInstead)!)}>
                    {t("cloudAccounts.presetOpenMicrosoft")}
                  </Button>
                </>
              )}
            </p>
          ))}
          {(plan.step || plan.guide) && !plan.useTileInstead && (
            <p className="m-hint">
              {plan.step && <span data-testid="connect-step-line">{t(plan.step.key, plan.step.values)} </span>}
              {plan.guide && (
                <Button size="sm" variant="ghost" data-testid="connect-guide" onClick={() => void getPlatformServices().openExternal(plan.guide!.url)}>
                  {t(plan.guide.label.key, plan.guide.label.values)}
                </Button>
              )}
            </p>
          )}
          {plan.other && (
            <GroupCard>
              <RowList>
                <Row
                  data-testid="connect-other-signin"
                  aria-expanded={otherOpen}
                  end={otherOpen ? <ChevronDown className="m-chevron" size={ICON.ui} /> : <ChevronRight className="m-chevron" size={ICON.ui} />}
                  onClick={() => { setOtherOpen(!otherOpen); setProbe({}); }}
                  subtitle={plan.other.contents.map((key) => t(key)).join(" · ")}
                  title={t(plan.other.labelKey)}
                />
              </RowList>
            </GroupCard>
          )}
          <ConnectStatusRows services={chosen} probe={probe} waitingKey={plan.waitingKey} provider={providerName} />
          {failureNote}
          <Button
            variant="primary"
            data-testid="connect-signin"
            disabled={running || !connectFieldsComplete(fields, values) || !!plan.useTileInstead}
            onClick={() => void signInWithForm()}
          >
            {running ? t("pim.connecting") : failed.length > 0 ? t("cloudAccounts.retry") : t(plan.button.key, plan.button.values)}
          </Button>
          {/* What could sign in goes on; what could not is left out of the run, as skipped. */}
          {failed.length > 0 && passed.length > 0 && !running && (
            <Button variant="ghost" data-testid="connect-continue-without" onClick={() => void signInWithForm(true)}>
              {t("connectRun.continueWithout", { services: failed.map(serviceLabel).join(", ") })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* ---------- services ---------- */
  const toggle = (service: CloudServiceId) => setPicked((prev) => (prev.includes(service) ? prev.filter((x) => x !== service) : [...prev, service]));
  const oauthKind = plan.kind === "oauthDevice" || plan.kind === "oauthAppKey";
  return (
    <div className="m-page">
      <AppBar onBack={() => setProvider(null)} title={providerName} />

      <div className="m-settings">
        {steps("pending")}
        <p className="m-hint">{t("cloudAccounts.pickServices")}</p>
        <GroupCard>
          <RowList>
            {SERVICE_ORDER.map((service) => {
              const Icon = SERVICE_ICON[service];
              // What the provider cannot carry stays in the list, off, with the reason (§ 5.1, step 2).
              const unavailable = serviceUnavailableKey(family, service);
              const taken = !unavailable && service === "files" && !!filesTakenBy;
              const off = !!unavailable || taken;
              return (
                <Row
                  key={service}
                  data-testid={`connect-service-${service}`}
                  disabled={off}
                  end={<Checkbox aria-label={serviceLabel(service)} checked={!off && picked.includes(service)} disabled={off} readOnly tabIndex={-1} />}
                  icon={<Icon className="m-accent" size={ICON.head} />}
                  // Always a button, so an offered-off row is a disabled one (a row without a handler is plain text).
                  onClick={() => { if (!off) toggle(service); }}
                  subtitle={unavailable
                    ? t(unavailable, { provider: providerName })
                    : taken && filesTakenBy ? t("cloudAccounts.filesTakenDetail", { account: filesTakenBy.label || familyLabel(filesTakenBy.family, filesTakenBy.flavor) }) : undefined}
                  title={serviceLabel(service)}
                  wrap={off}
                />
              );
            })}
          </RowList>
        </GroupCard>

        {oauthKind && head}
        {failureNote}
        <Button
          data-testid="connect-start"
          disabled={chosen.length === 0 || starting}
          onClick={() => void start()}
          variant="primary"
        >
          {oauthKind ? t(plan.button.key, plan.button.values) : t("cloudAccounts.stepSignIn")}
        </Button>
        {/* "Other sign-in" at the same place for every provider that signs in through the browser;
            the others hold theirs on the sign-in page, beside the form. */}
        {oauthKind && plan.other && (
          <GroupCard>
            <RowList>
              <Row
                data-testid="connect-other-signin"
                end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                onClick={() => setOtherOpen(true)}
                subtitle={plan.other.contents.map((key) => t(key)).join(" · ")}
                title={t(plan.other.labelKey)}
              />
            </RowList>
          </GroupCard>
        )}
      </div>
      {otherOpen && oauthKind && accessFamily && (
        <AccountAccessSheet
          family={accessFamily}
          title={t("cloudAccounts.otherSignIn")}
          onCancel={() => setOtherOpen(false)}
          onSaved={() => { setOtherOpen(false); setAccessFor(null); void deviceAccess(accessFamily).then(setAccess); }}
          extra={family === "google" && chosen.includes("mail") ? (
            <GroupCard>
              <RowList>
                <Row
                  controls
                  end={<Switch checked={gmailByPassword} label={t("cloudAccounts.mailByAppPassword")} onChange={setGmailByPassword} testId="connect-gmail-by-password" />}
                  icon={<Mail className="m-accent" size={ICON.ui} />}
                  subtitle={t("cloudAccounts.mailByAppPasswordHint")}
                  title={t("cloudAccounts.mailByAppPassword")}
                  wrap
                />
              </RowList>
            </GroupCard>
          ) : undefined}
        />
      )}
      {accessFor && (
        <AccountAccessSheet
          family={accessFor}
          onCancel={() => setAccessFor(null)}
          onSaved={() => { setAccessFor(null); void start(); }}
        />
      )}
    </div>
  );
}

/** The fields of the one form, as the plan names them. */
function ConnectForm({ fields, values, disabled, onChange }: {
  fields: readonly ConnectField[];
  values: ConnectFormValues;
  disabled: boolean;
  onChange: (id: ConnectField["id"], value: string) => void;
}) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  return (
    <GroupCard>
      <RowList>
        {fields.map((field) => {
          const value = values[field.id] ?? field.prefill ?? "";
          const testId = `connect-field-${field.id}`;
          if (field.input === "switch") {
            return (
              <Row
                key={field.id}
                controls
                title={t(field.labelKey)}
                end={<Switch checked={value !== "off"} disabled={disabled} label={t(field.labelKey)} onChange={(on) => onChange(field.id, on ? "on" : "off")} testId={testId} />}
              />
            );
          }
          if (field.input === "preset") {
            const label = value === "custom" || !value ? t("mail.customProvider") : (MAIL_PRESETS.find((preset) => preset.id === value)?.label ?? value);
            return (
              <Row
                key={field.id}
                data-testid={testId}
                title={t(field.labelKey)}
                end={<><span className="m-prop-val">{label}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                onClick={disabled ? undefined : () => void mSelect({
                  title: t(field.labelKey),
                  options: [...MAIL_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })), { value: "custom", label: t("mail.customProvider") }],
                  value: value || "custom",
                }).then((next) => { if (next !== null) onChange(field.id, next); })}
              />
            );
          }
          return (
            <SettingField key={field.id} label={t(field.labelKey)}>
              <TextInput
                type={field.input === "secret" ? "password" : field.input === "email" ? "email" : "text"}
                purpose={field.input === "address" ? "address" : field.input === "keyId" ? "secret" : undefined}
                inputMode={field.input === "port" ? "numeric" : field.input === "address" ? "url" : field.input === "email" ? "email" : undefined}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete={field.input === "secret" ? "new-password" : "off"}
                value={value}
                placeholder={field.placeholder}
                disabled={disabled}
                onChange={(event) => onChange(field.id, event.target.value)}
                aria-label={t(field.labelKey)}
                data-testid={testId}
              />
            </SettingField>
          );
        })}
      </RowList>
    </GroupCard>
  );
}

/** One row per chosen service: waiting, connecting, connected - or its failure with the sender. */
export function ConnectStatusRows({ services, probe, waitingKey, provider }: {
  services: readonly CloudServiceId[];
  probe: Partial<Record<CloudServiceId, ProbeState>>;
  waitingKey: string;
  provider: string;
}) {
  const { t } = useTranslation();
  if (services.length === 0) return null;
  return (
    <GroupCard>
      <RowList>
        {services.map((service) => {
          const state = probe[service];
          const view = state?.state === "error" ? serviceConnectionFailure(state.error, t, { provider }) : null;
          const Icon = state?.state === "ok" ? Check : state?.state === "error" ? AlertCircle : Clock;
          return (
            <Row
              key={service}
              data-testid={`connect-status-${service}`}
              data-state={state?.state ?? "idle"}
              icon={<Icon size={ICON.ui} className={state?.state === "error" ? "m-danger" : state?.state === "ok" ? "m-accent" : undefined} />}
              title={serviceLabel(service)}
              subtitle={view
                // Sender, sentence and the failure's own words stacked, as the run's frame says a failure.
                ? <span className="m-connectrun-note-text">{view.title && <strong>{view.title}</strong>}<span>{view.text}</span>{view.raw && <code className="m-connectrun-raw">{view.raw}</code>}</span>
                : t(state?.state === "ok" ? "cloudAccounts.statusConnected" : state?.state === "pending" ? "pim.connecting" : waitingKey)}
              wrap
            />
          );
        })}
      </RowList>
    </GroupCard>
  );
}
