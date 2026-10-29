import { FAMILY_SERVICES, type CloudProviderFamily, type CloudServiceId } from "./cloudAccounts";
import { MAIL_PRESETS, presetById, presetForEmail, suiteProvider, type MailPreset, type ProviderAuthMode } from "./providerCatalog";
import { ONEDRIVE_DROPBOX_BYO_GUIDE, userGuideUrl } from "./docsLinks";

/**
 * The sign-in step of connecting an account, for EVERY provider (settings
 * plan 2026-10-29, § 5, package P5).
 *
 * Google and Microsoft set the shape: a head that says which services are
 * asked for and how, "Other sign-in" at one place, one status line per
 * service, and a main button that names the method. Every other provider
 * drew its own form until now - Dropbox without a head, the app-password
 * suites with "Connect", the phone with one form per service. Both shells
 * now draw the step from this one description; only what the ACCESS KIND
 * needs differs:
 *
 *  - `oauthDevice` - Google, Microsoft: the browser, standard or own client per device
 *  - `oauthAppKey` - Dropbox: the browser, standard or own app key per device (E6)
 *  - `credentials` - the suites, WebDAV/Nextcloud, IMAP: ONE form for all chosen services (E5)
 *  - `keys`        - S3: access key and secret key
 *  - `permission`  - the phone's own calendars: the system's permission
 *
 * Pure: keys and values for the shells' `t`, no platform calls.
 */

export type ConnectAccessKind = "oauthDevice" | "oauthAppKey" | "credentials" | "keys" | "permission";

/** Which secret the provider expects - named as the provider names it, never "app password" where it takes the normal one. */
export type ConnectSecretKind = "appPassword" | "password" | "authCode" | "mailPassword" | "secretKey";

export type ConnectFieldId =
  | "email"
  | "server"
  | "user"
  | "secret"
  | "filesUrl"
  | "caldavUrl"
  | "mailProvider"
  | "imapHost"
  | "imapPort"
  | "smtpHost"
  | "smtpPort"
  | "endpoint"
  | "bucket"
  | "region"
  | "accessKeyId"
  | "prefix"
  | "pathStyle";

export interface ConnectField {
  id: ConnectFieldId;
  labelKey: string;
  /** How the shell draws it: an address folds full-width forms, a secret hides, a port is short. */
  input: "text" | "email" | "address" | "keyId" | "secret" | "port" | "switch" | "preset";
  /** Must be filled (or on, for a switch) before the main button works. */
  required: boolean;
  /** What the catalog already knows, prefilled into the field. */
  prefill?: string;
  placeholder?: string;
}

export interface ConnectText {
  key: string;
  values?: Record<string, string | number>;
}

/** "Other sign-in": one disclosure at the same place for every provider, holding what that provider has besides the standard way. */
export interface ConnectOther {
  /** "Other sign-in", or "Advanced" for S3. */
  labelKey: string;
  /** What it holds, said while it is folded: "own client ID · email by app password". */
  contents: string[];
  /** The editor kind the shell opens. */
  holds: "clientId" | "appKey" | "endpoints" | "servers" | "advanced";
  /** Fields that only show while it is open. */
  fields: ConnectField[];
  /** Main fields it replaces while open (Nextcloud: the single address gives way to the two endpoints). */
  replaces: ConnectFieldId[];
}

export interface ConnectAccessPlan {
  kind: ConnectAccessKind;
  family: CloudProviderFamily;
  flavor?: "nextcloud";
  /** The secret's name, where the kind has one. */
  secret: ConnectSecretKind | null;
  /** The form; empty for the browser and the permission. */
  fields: ConnectField[];
  /** The visible step "Create it at X and paste it here." - only where the provider needs one created. */
  step: ConnectText | null;
  /** The guide link: the provider's page for the secret, or the user guide's setup page. */
  guide: { url: string; label: ConnectText } | null;
  /** Things that must be done first or block the way (IMAP: enable first, Bridge, Outlook). */
  notes: ConnectText[];
  /** The address names a provider whose IMAP is closed: the main button stays off, the note points to its tile. */
  useTileInstead: CloudProviderFamily | null;
  /** The head line under the chosen services (OAuth kinds: see `accessSummary`). */
  summary: ConnectText;
  /** The main button: it names the method (Apple HIG). */
  button: ConnectText;
  other: ConnectOther | null;
  /** A service's line before it ran. */
  waitingKey: string;
}

export interface ConnectAccessInput {
  family: CloudProviderFamily;
  flavor?: "nextcloud";
  /** The chosen services (order does not matter). */
  services: readonly CloudServiceId[];
  /** The provider's display name ("Fastmail", "Nextcloud"), for the sentences that name it. */
  providerName: string;
  /** IMAP: the preset the address or the choice names; null or absent = an own server. */
  preset?: MailPreset | null;
  /** Google: mail goes by app password, outside the consent (E5 of the sign-in plan). */
  gmailByPassword?: boolean;
}

export function connectAccessKind(family: CloudProviderFamily): ConnectAccessKind {
  if (family === "google" || family === "microsoft") return "oauthDevice";
  if (family === "dropbox") return "oauthAppKey";
  if (family === "s3") return "keys";
  if (family === "device") return "permission";
  return "credentials";
}

function secretOfAuthMode(mode: ProviderAuthMode): ConnectSecretKind {
  return mode === "app-password" ? "appPassword" : mode === "auth-code" ? "authCode" : mode === "mail-password" ? "mailPassword" : "password";
}

/**
 * The secret this provider takes. A suite says so in the catalog; an IMAP
 * mailbox by its preset; WebDAV and Nextcloud take the account password (an
 * app password works too, and is what Nextcloud asks for under two-factor -
 * that is the provider's choice, not a requirement).
 */
export function connectSecretOf(family: CloudProviderFamily, preset?: MailPreset | null): ConnectSecretKind | null {
  const kind = connectAccessKind(family);
  if (kind === "keys") return "secretKey";
  if (kind !== "credentials") return family === "google" ? "appPassword" : null;
  const suite = suiteProvider(family);
  if (suite) return secretOfAuthMode(suite.authMode);
  if (family === "imap") return preset && !preset.bridge ? secretOfAuthMode(preset.authMode) : "password";
  return "password";
}

// Every key written out, so the locale guard sees each one in use.
const SECRET_LABEL: Record<ConnectSecretKind, string> = {
  appPassword: "connectAccess.secret.appPassword",
  password: "connectAccess.secret.password",
  authCode: "connectAccess.secret.authCode",
  mailPassword: "connectAccess.secret.mailPassword",
  secretKey: "connectAccess.secret.secretKey",
};
const NEW_SECRET_LABEL: Record<ConnectSecretKind, string> = {
  appPassword: "connectAccess.newSecret.appPassword",
  password: "connectAccess.newSecret.password",
  authCode: "connectAccess.newSecret.authCode",
  mailPassword: "connectAccess.newSecret.mailPassword",
  secretKey: "connectAccess.newSecret.secretKey",
};
type FormSecret = Exclude<ConnectSecretKind, "secretKey">;
const SECRET_STEP: Partial<Record<FormSecret, string>> = {
  appPassword: "connectAccess.step.appPassword",
  authCode: "connectAccess.step.authCode",
  mailPassword: "connectAccess.step.mailPassword",
};
const SUMMARY_ONE: Record<FormSecret, string> = {
  appPassword: "connectAccess.summary.secretOne.appPassword",
  password: "connectAccess.summary.secretOne.password",
  authCode: "connectAccess.summary.secretOne.authCode",
  mailPassword: "connectAccess.summary.secretOne.mailPassword",
};
const SUMMARY_ALL: Record<FormSecret, string> = {
  appPassword: "connectAccess.summary.secretAll.appPassword",
  password: "connectAccess.summary.secretAll.password",
  authCode: "connectAccess.summary.secretAll.authCode",
  mailPassword: "connectAccess.summary.secretAll.mailPassword",
};
const SECRET_BUTTON: Record<FormSecret, string> = {
  appPassword: "cloudAccounts.connectAppPassword",
  password: "connectAccess.button.password",
  authCode: "connectAccess.button.authCode",
  mailPassword: "connectAccess.button.mailPassword",
};
const UNAVAILABLE: Record<CloudServiceId, string> = {
  files: "connectAccess.unavailable.files",
  calendar: "connectAccess.unavailable.calendar",
  mail: "connectAccess.unavailable.mail",
};

/** The label of the secret's field: "App password", "Password", "Secret key". */
export function connectSecretLabelKey(secret: ConnectSecretKind): string {
  return SECRET_LABEL[secret];
}

/** The field of the credentials panel that replaces it: "New app password", "New secret key". */
export function connectNewSecretLabelKey(secret: ConnectSecretKind): string {
  return NEW_SECRET_LABEL[secret];
}

/**
 * The secret of an account that is already connected, for its page and its
 * credentials panel. IMAP reads its preset from the server it signs in to.
 */
export function accountSecretOf(family: CloudProviderFamily, imapHost?: string): ConnectSecretKind | null {
  if (family !== "imap") return connectSecretOf(family);
  const host = imapHost?.trim().toLowerCase().split(":")[0] ?? "";
  return connectSecretOf(family, host ? (MAIL_PRESETS.find((preset) => preset.host === host) ?? null) : null);
}

const field = (id: ConnectFieldId, labelKey: string, input: ConnectField["input"], required: boolean, extra: Partial<ConnectField> = {}): ConnectField => ({ id, labelKey, input, required, ...extra });

function secretField(secret: ConnectSecretKind): ConnectField {
  return field("secret", connectSecretLabelKey(secret), "secret", true);
}

function serverFields(required: boolean, preset?: MailPreset | null): ConnectField[] {
  return [
    field("imapHost", "cloudAccounts.imapHost", "address", required, { prefill: preset?.host }),
    field("imapPort", "mail.imapPort", "port", required, { prefill: String(preset?.port ?? 993) }),
    field("smtpHost", "cloudAccounts.smtpHost", "address", false, { prefill: preset?.smtpHost }),
    field("smtpPort", "mail.smtpPort", "port", false, { prefill: String(preset?.smtpPort ?? 587) }),
  ];
}

/** The page where the provider hands out the secret, if it has one to link. */
function secretGuideUrl(input: ConnectAccessInput): string | null {
  if (input.family === "google") return presetById("gmail")?.appPasswordUrl ?? null;
  const suite = suiteProvider(input.family);
  if (suite) return suite.helpUrl;
  if (input.family === "imap" && input.preset) return input.preset.appPasswordUrl ?? input.preset.helpUrl ?? null;
  return null;
}

/** The provider name a step sentence uses: the preset's own for an IMAP mailbox ("GMX"), else the provider's. */
function stepProvider(input: ConnectAccessInput): string {
  return input.family === "imap" && input.preset ? input.preset.label : input.family === "google" ? "Google" : input.providerName;
}

const SUMMARY_PERMISSION: ConnectText = { key: "connectAccess.summary.permission" };

/**
 * What the sign-in step shows for this provider and these services.
 *
 * The OAuth kinds have no fields: their head line depends on this device's
 * access and comes from `accessSummary`; `summary` is the standard line.
 */
export function connectAccessPlan(input: ConnectAccessInput): ConnectAccessPlan {
  const kind = connectAccessKind(input.family);
  const services = FAMILY_SERVICES[input.family].filter((service) => input.services.includes(service));
  const base = { kind, family: input.family, ...(input.flavor ? { flavor: input.flavor } : {}), notes: [] as ConnectText[], useTileInstead: null, guide: null, step: null };

  if (kind === "oauthDevice") {
    const google = input.family === "google";
    const mailOnly = google && !!input.gmailByPassword && services.length === 1 && services[0] === "mail";
    const gmail = google && !!input.gmailByPassword && services.includes("mail");
    const guideUrl = gmail ? secretGuideUrl(input) : null;
    return {
      ...base,
      secret: gmail ? "appPassword" : null,
      // Gmail by app password: the address and the app password, the rest of the account through the browser.
      fields: gmail ? [field("email", "mail.emailAddress", "email", true), secretField("appPassword")] : [],
      step: gmail ? { key: SECRET_STEP.appPassword!, values: { provider: "Google" } } : null,
      guide: guideUrl ? { url: guideUrl, label: { key: "cloudAccounts.gmailAppPasswordLink" } } : null,
      summary: services.length > 1 ? { key: "cloudAccounts.standardSignInLine", values: { provider: input.providerName } } : { key: "connectAccess.summary.standard" },
      button: mailOnly ? { key: "cloudAccounts.connectAppPassword" } : { key: google ? "cloudAccounts.signInGoogle" : "cloudAccounts.signInMicrosoft" },
      other: {
        labelKey: "cloudAccounts.otherSignIn",
        contents: ["cloudAccounts.otherSignInClient", ...(google && services.includes("mail") ? ["cloudAccounts.mailByAppPassword"] : [])],
        holds: "clientId",
        fields: [],
        replaces: [],
      },
      waitingKey: "cloudAccounts.statusWaiting",
    };
  }

  if (kind === "oauthAppKey") {
    return {
      ...base,
      secret: null,
      fields: [],
      summary: { key: "connectAccess.summary.standard" },
      button: { key: "cloudAccounts.signInDropbox" },
      other: { labelKey: "cloudAccounts.otherSignIn", contents: ["connectAccess.other.appKey"], holds: "appKey", fields: [], replaces: [] },
      waitingKey: "cloudAccounts.statusWaiting",
    };
  }

  if (kind === "permission") {
    return { ...base, secret: null, fields: [], summary: SUMMARY_PERMISSION, button: { key: "connectAccess.button.permission" }, other: null, waitingKey: "connectAccess.statusNotYet" };
  }

  if (kind === "keys") {
    return {
      ...base,
      secret: "secretKey",
      fields: [
        field("endpoint", "settings.s3Endpoint", "address", true, { placeholder: "https://s3.eu-central-1.amazonaws.com" }),
        field("bucket", "settings.s3Bucket", "address", true),
        field("accessKeyId", "cloudAccounts.accessKeyId", "keyId", true),
        secretField("secretKey"),
      ],
      guide: { url: userGuideUrl("Sync_Setup.md"), label: { key: "connectAccess.guide" } },
      summary: { key: "connectAccess.summary.keys" },
      button: { key: "pim.connect" },
      other: {
        labelKey: "connectAccess.other.advancedLabel",
        contents: ["connectAccess.other.keysAdvanced"],
        holds: "advanced",
        fields: [
          field("region", "settings.s3Region", "address", false, { placeholder: "us-east-1" }),
          field("prefix", "settings.s3Prefix", "text", false),
          field("pathStyle", "settings.s3PathStyle", "switch", false, { prefill: "on" }),
        ],
        replaces: [],
      },
      waitingKey: "connectAccess.statusNotYet",
    };
  }

  // Credentials: ONE form for every chosen service (E5).
  const found = connectSecretOf(input.family, input.preset);
  const secret: FormSecret = found && found !== "secretKey" ? found : "password";
  const summary: ConnectText = { key: (services.length > 1 ? SUMMARY_ALL : SUMMARY_ONE)[secret] };
  const button: ConnectText = { key: SECRET_BUTTON[secret] };
  const guideUrl = secretGuideUrl(input);
  const stepKey = SECRET_STEP[secret];
  const step: ConnectText | null = stepKey && guideUrl ? { key: stepKey, values: { provider: stepProvider(input) } } : null;
  const guide = guideUrl ? { url: guideUrl, label: { key: "cloudAccounts.providerHelp", values: { provider: stepProvider(input) } } } : null;
  const common = { ...base, secret, summary, button, step, guide, waitingKey: "connectAccess.statusNotYet" };

  const suite = suiteProvider(input.family);
  if (suite) {
    const endpoints: ConnectField[] = [
      ...(services.includes("files") ? [field("filesUrl", "cloudAccounts.endpointFiles", "address", true, { prefill: suite.endpoints.webdavUrl })] : []),
      ...(services.includes("calendar") ? [field("caldavUrl", "cloudAccounts.endpointCalendar", "address", true, { prefill: suite.endpoints.caldavUrl })] : []),
      ...(services.includes("mail")
        ? serverFields(true, { host: suite.endpoints.imapHost ?? "", port: suite.endpoints.imapPort ?? 993, smtpHost: suite.endpoints.smtpHost ?? "", smtpPort: suite.endpoints.smtpPort ?? 587 } as MailPreset)
        : []),
    ];
    return {
      ...common,
      fields: [field("email", "mail.emailAddress", "email", true), secretField(secret)],
      other: { labelKey: "cloudAccounts.otherSignIn", contents: ["connectAccess.other.endpoints"], holds: "endpoints", fields: endpoints, replaces: [] },
    };
  }

  if (input.family === "webdav" && input.flavor === "nextcloud") {
    return {
      ...common,
      guide: { url: userGuideUrl("Sync_Setup.md"), label: { key: "connectAccess.guide" } },
      fields: [field("server", "cloudAccounts.serverAddress", "address", true, { placeholder: "https://cloud.example.com" }), field("user", "settings.username", "text", true), secretField(secret)],
      other: {
        labelKey: "cloudAccounts.otherSignIn",
        contents: ["connectAccess.other.endpoints"],
        holds: "endpoints",
        fields: [
          ...(services.includes("files") ? [field("filesUrl", "cloudAccounts.endpointFiles", "address", true)] : []),
          ...(services.includes("calendar") ? [field("caldavUrl", "cloudAccounts.endpointCalendar", "address", true)] : []),
        ],
        replaces: ["server"],
      },
    };
  }

  if (input.family === "webdav") {
    // A server of its own: the addresses ARE the sign-in, nothing to fold away.
    return {
      ...common,
      guide: { url: userGuideUrl("Sync_Setup.md"), label: { key: "connectAccess.guide" } },
      fields: [
        ...(services.includes("files") ? [field("filesUrl", "cloudAccounts.endpointFiles", "address", true, { placeholder: "https://dav.example.com/files/" })] : []),
        ...(services.includes("calendar") ? [field("caldavUrl", "cloudAccounts.endpointCalendar", "address", true, { placeholder: "https://dav.example.com/caldav/" })] : []),
        field("user", "settings.username", "text", true),
        secretField(secret),
      ],
      other: null,
    };
  }

  // IMAP: the address names the provider; an unknown one shows its servers right away.
  const preset = input.preset ?? null;
  const notes: ConnectText[] = [];
  if (preset?.useTileInstead) notes.push({ key: "cloudAccounts.presetUseMicrosoft" });
  else {
    if (preset?.bridge) notes.push({ key: "cloudAccounts.hintBridge" });
    if (preset?.enableHint) notes.push({ key: "cloudAccounts.hintEnableFirst", values: { provider: preset.label } });
  }
  const providerField = field("mailProvider", "mail.provider", "preset", false, { prefill: preset?.id ?? "custom" });
  return {
    ...common,
    notes,
    useTileInstead: preset?.useTileInstead ?? null,
    fields: [field("email", "mail.emailAddress", "email", true), ...(preset ? [] : [providerField, ...serverFields(true, null)]), secretField(secret)],
    other: preset ? { labelKey: "cloudAccounts.otherSignIn", contents: ["connectAccess.other.servers"], holds: "servers", fields: [providerField, ...serverFields(true, preset)], replaces: [] } : null,
  };
}

/** The preset an address names, for the IMAP form ("custom" picks follow the address). */
export function connectPresetFor(choice: string, email: string): MailPreset | null {
  return choice === "custom" ? presetForEmail(email) : (presetById(choice) ?? null);
}

/** The OAuth kinds' head line, from this device's access: standard, own (with the tail of its id), or what is missing. */
export function accessSummary(
  plan: Pick<ConnectAccessPlan, "kind" | "summary">,
  access: { ok: true; source: "plainva" | "own"; id: string } | { ok: false; problemKey: string },
): ConnectText {
  if (!access.ok) return { key: access.problemKey };
  if (access.source === "plainva") return plan.summary;
  return { key: plan.kind === "oauthAppKey" ? "accountAccess.ownKeyLine" : "accountAccess.ownLine", values: { id: access.id } };
}

/** The guide for an own app key (Dropbox), the same page the account page links. */
export function ownAppKeyGuideUrl(): string {
  return userGuideUrl(ONEDRIVE_DROPBOX_BYO_GUIDE);
}

/** One entry of the provider list both shells offer, in reach order (maintainer decision 2026-07-20). */
export interface ConnectProvider {
  key: string;
  family: CloudProviderFamily;
  flavor?: "nextcloud";
}

/** The providers to connect, Google and Microsoft first, the generic mechanics (WebDAV/S3/IMAP) last. Nextcloud is its own entry in both shells. */
export const CONNECT_PROVIDERS: readonly ConnectProvider[] = [
  { key: "google", family: "google" },
  { key: "microsoft", family: "microsoft" },
  { key: "apple", family: "apple" },
  { key: "yahoo", family: "yahoo" },
  { key: "dropbox", family: "dropbox" },
  { key: "aol", family: "aol" },
  { key: "yandex", family: "yandex" },
  { key: "mailru", family: "mailru" },
  { key: "nextcloud", family: "webdav", flavor: "nextcloud" },
  { key: "zoho", family: "zoho" },
  { key: "pcloud", family: "pcloud" },
  { key: "fastmail", family: "fastmail" },
  { key: "mailboxorg", family: "mailboxorg" },
  { key: "koofr", family: "koofr" },
  { key: "webdav", family: "webdav" },
  { key: "s3", family: "s3" },
  { key: "imap", family: "imap" },
];

/**
 * The search over the provider list. It also finds IMAP presets: "Orange"
 * shows the mail entry with that provider picked; a preset that is a dead
 * end ("Outlook") shows the entry it points to.
 */
export function searchConnectProviders(
  query: string,
  label: (provider: ConnectProvider) => string,
  providers: readonly ConnectProvider[] = CONNECT_PROVIDERS,
): { visible: ConnectProvider[]; presetHit: MailPreset | null; presetKey: string | null } {
  const q = query.trim().toLowerCase();
  if (!q) return { visible: [...providers], presetHit: null, presetKey: null };
  const presetHit = MAIL_PRESETS.find((preset) => preset.label.toLowerCase().includes(q) || preset.domains.some((domain) => domain.includes(q))) ?? null;
  const presetKey = presetHit ? (presetHit.useTileInstead ?? "imap") : null;
  return { visible: providers.filter((provider) => label(provider).toLowerCase().includes(q) || provider.key === presetKey), presetHit, presetKey };
}

/** Why a service a provider cannot carry is offered off (settings plan § 5.1, step 2). */
export function serviceUnavailableKey(family: CloudProviderFamily, service: CloudServiceId): string | null {
  if (FAMILY_SERVICES[family].includes(service)) return null;
  if (family === "apple" && service === "files") return "cloudAccounts.appleNoFiles";
  return UNAVAILABLE[service];
}

/**
 * The services ticked when the step opens, the same in both shells: what the
 * provider can carry, files only while no other account carries them, the
 * calendar only where the vault can hold one. A side door (calendar, mail,
 * a new cloud vault) ticks just its own service (E7).
 */
export function preselectedServices(
  family: CloudProviderFamily,
  options: { filesTaken: boolean; calendarAvailable: boolean; only?: CloudServiceId },
): Record<CloudServiceId, boolean> {
  const offered = FAMILY_SERVICES[family];
  const can = (service: CloudServiceId) => offered.includes(service) && (service !== "files" || !options.filesTaken) && (service !== "calendar" || options.calendarAvailable);
  if (options.only) return { files: options.only === "files" && can("files"), calendar: options.only === "calendar" && can("calendar"), mail: options.only === "mail" && can("mail") };
  return { files: can("files"), calendar: can("calendar"), mail: can("mail") };
}

/** Whether the shown fields of a plan are filled: the main button's other half (the running state is the shell's). */
export function connectFieldsComplete(fields: readonly ConnectField[], values: Partial<Record<ConnectFieldId, string>>): boolean {
  return fields.every((entry) => !entry.required || entry.input === "switch" || !!(values[entry.id] ?? entry.prefill ?? "").trim());
}

/** The fields on screen: the main ones, and while "Other sign-in" is open its own instead of those it replaces. */
export function shownConnectFields(plan: Pick<ConnectAccessPlan, "fields" | "other">, otherOpen: boolean): ConnectField[] {
  if (!otherOpen || !plan.other) return plan.fields;
  if (plan.other.holds === "advanced") return [...plan.fields, ...plan.other.fields];
  const replaced = new Set(plan.other.replaces);
  const main = plan.fields.filter((entry) => !replaced.has(entry.id));
  // The secret stays last: the person types it after the addresses.
  const secretAt = main.findIndex((entry) => entry.id === "secret");
  if (secretAt < 0) return [...main, ...plan.other.fields];
  return [...main.slice(0, secretAt), ...plan.other.fields.filter((entry) => entry.id !== "secret"), ...main.slice(secretAt)];
}
