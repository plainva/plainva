import { describe, expect, it } from "vitest";
import {
  CONNECT_PROVIDERS,
  FAMILY_SERVICES,
  PLAINVA_DROPBOX_APP_KEY,
  accessSummary,
  accountSecretOf,
  adoptedDropboxAccess,
  connectAccessKind,
  connectAccessPlan,
  connectFieldsComplete,
  connectNewSecretLabelKey,
  connectRunSteps,
  connectSecretOf,
  presetById,
  preselectedServices,
  resolveDropboxAccess,
  searchConnectProviders,
  serviceUnavailableKey,
  shownConnectFields,
  validClientId,
  type CloudServiceId,
  type ConnectAccessPlan,
} from "@plainva/ui";
import de from "../../../packages/ui/src/locales/de.json";
import en from "../../../packages/ui/src/locales/en.json";

/**
 * The sign-in step for every provider (settings plan 2026-10-29, P5): one
 * description both shells draw. Each provider family is pinned here by what
 * the step shows - kind, fields, the secret's name, the button, the head
 * line and "Other sign-in" - and every key it hands out must exist.
 */

const lookup = (catalog: unknown, key: string): unknown => key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);

function keysOf(plan: ConnectAccessPlan): string[] {
  return [
    plan.summary.key,
    plan.button.key,
    plan.waitingKey,
    ...(plan.step ? [plan.step.key] : []),
    ...(plan.guide ? [plan.guide.label.key] : []),
    ...plan.notes.map((note) => note.key),
    ...plan.fields.map((field) => field.labelKey),
    ...(plan.other ? [plan.other.labelKey, ...plan.other.contents, ...plan.other.fields.map((field) => field.labelKey)] : []),
  ];
}

const all = (family: (typeof CONNECT_PROVIDERS)[number]["family"]): CloudServiceId[] => [...FAMILY_SERVICES[family]];

describe("connect access model", () => {
  it("every provider of the list draws a step whose keys exist in German and English", () => {
    for (const provider of CONNECT_PROVIDERS) {
      const plan = connectAccessPlan({ family: provider.family, flavor: provider.flavor, services: all(provider.family), providerName: "X" });
      for (const key of keysOf(plan)) {
        expect(typeof lookup(de, key), `${provider.key}: ${key} (de)`).toBe("string");
        expect(typeof lookup(en, key), `${provider.key}: ${key} (en)`).toBe("string");
      }
    }
  });

  it("names the access kind of each family", () => {
    expect(connectAccessKind("google")).toBe("oauthDevice");
    expect(connectAccessKind("microsoft")).toBe("oauthDevice");
    expect(connectAccessKind("dropbox")).toBe("oauthAppKey");
    expect(connectAccessKind("s3")).toBe("keys");
    expect(connectAccessKind("device")).toBe("permission");
    for (const family of ["apple", "fastmail", "mailboxorg", "pcloud", "webdav", "imap"] as const) expect(connectAccessKind(family)).toBe("credentials");
  });

  it("Google: no fields, the standard line for all services, Bei Google anmelden, other sign-in holds the client and Gmail by app password", () => {
    const plan = connectAccessPlan({ family: "google", services: ["files", "calendar", "mail"], providerName: "Google" });
    expect(plan.fields).toEqual([]);
    expect(plan.summary).toEqual({ key: "cloudAccounts.standardSignInLine", values: { provider: "Google" } });
    expect(plan.button.key).toBe("cloudAccounts.signInGoogle");
    expect(plan.other?.holds).toBe("clientId");
    expect(plan.other?.contents).toEqual(["cloudAccounts.otherSignInClient", "cloudAccounts.mailByAppPassword"]);
    expect(plan.waitingKey).toBe("cloudAccounts.statusWaiting");
  });

  it("Google with Gmail by app password: the address and the app password; mail alone connects with the app password", () => {
    const mixed = connectAccessPlan({ family: "google", services: ["files", "mail"], providerName: "Google", gmailByPassword: true });
    expect(mixed.fields.map((field) => field.id)).toEqual(["email", "secret"]);
    expect(mixed.fields[1].labelKey).toBe("connectAccess.secret.appPassword");
    expect(mixed.button.key).toBe("cloudAccounts.signInGoogle");
    expect(mixed.step).toEqual({ key: "connectAccess.step.appPassword", values: { provider: "Google" } });
    const mailOnly = connectAccessPlan({ family: "google", services: ["mail"], providerName: "Google", gmailByPassword: true });
    expect(mailOnly.button.key).toBe("cloudAccounts.connectAppPassword");
  });

  it("Microsoft: Bei Microsoft anmelden, no Gmail in other sign-in", () => {
    const plan = connectAccessPlan({ family: "microsoft", services: ["mail"], providerName: "Microsoft" });
    expect(plan.button.key).toBe("cloudAccounts.signInMicrosoft");
    expect(plan.summary.key).toBe("connectAccess.summary.standard");
    expect(plan.other?.contents).toEqual(["cloudAccounts.otherSignInClient"]);
  });

  it("Dropbox: the same head as Google, other sign-in holds the app key, Bei Dropbox anmelden", () => {
    const plan = connectAccessPlan({ family: "dropbox", services: ["files"], providerName: "Dropbox" });
    expect(plan.kind).toBe("oauthAppKey");
    expect(plan.summary.key).toBe("connectAccess.summary.standard");
    expect(plan.button.key).toBe("cloudAccounts.signInDropbox");
    expect(plan.other).toMatchObject({ labelKey: "cloudAccounts.otherSignIn", holds: "appKey", contents: ["connectAccess.other.appKey"] });
    expect(accessSummary(plan, { ok: true, source: "own", id: "…abc123" })).toEqual({ key: "accountAccess.ownKeyLine", values: { id: "…abc123" } });
    expect(accessSummary(plan, { ok: true, source: "plainva", id: "x" })).toEqual(plan.summary);
    expect(accessSummary(plan, { ok: false, problemKey: "accountAccess.problem.ownClientMissing" }).key).toBe("accountAccess.problem.ownClientMissing");
  });

  it("Fastmail: one form for all three services, App-Passwort, the step to create it with the provider's guide, endpoints under other sign-in", () => {
    const plan = connectAccessPlan({ family: "fastmail", services: ["files", "calendar", "mail"], providerName: "Fastmail" });
    expect(plan.fields.map((field) => field.id)).toEqual(["email", "secret"]);
    expect(plan.secret).toBe("appPassword");
    expect(plan.fields[1].labelKey).toBe("connectAccess.secret.appPassword");
    expect(plan.summary.key).toBe("connectAccess.summary.secretAll.appPassword");
    expect(plan.button.key).toBe("cloudAccounts.connectAppPassword");
    expect(plan.step).toEqual({ key: "connectAccess.step.appPassword", values: { provider: "Fastmail" } });
    expect(plan.guide?.url).toContain("fastmail.help");
    expect(plan.other?.holds).toBe("endpoints");
    expect(plan.other?.fields.map((field) => field.id)).toEqual(["filesUrl", "caldavUrl", "imapHost", "imapPort", "smtpHost", "smtpPort"]);
    expect(plan.other?.fields[0].prefill).toBe("https://webdav.fastmail.com");
    expect(plan.waitingKey).toBe("connectAccess.statusNotYet");
    // Opened, the endpoints stand before the secret.
    const opened = shownConnectFields(plan, true).map((field) => field.id);
    expect(opened[opened.length - 1]).toBe("secret");
  });

  it("mailbox.org and pCloud take the normal password: no app password anywhere, no creation step", () => {
    for (const family of ["mailboxorg", "pcloud"] as const) {
      const plan = connectAccessPlan({ family, services: all(family), providerName: family });
      expect(plan.secret).toBe("password");
      expect(plan.fields.find((field) => field.id === "secret")?.labelKey).toBe("connectAccess.secret.password");
      expect(plan.button.key).toBe("connectAccess.button.password");
      expect(plan.step).toBeNull();
      expect(JSON.stringify(plan)).not.toMatch(/appPassword|AppPassword/);
    }
  });

  it("a single service says 'with your …', several say 'one … for every chosen service'", () => {
    expect(connectAccessPlan({ family: "apple", services: ["mail"], providerName: "Apple" }).summary.key).toBe("connectAccess.summary.secretOne.appPassword");
    expect(connectAccessPlan({ family: "apple", services: ["calendar", "mail"], providerName: "Apple" }).summary.key).toBe("connectAccess.summary.secretAll.appPassword");
  });

  it("Nextcloud: one address, user, password; the two endpoints under other sign-in replace the address", () => {
    const plan = connectAccessPlan({ family: "webdav", flavor: "nextcloud", services: ["files", "calendar"], providerName: "Nextcloud" });
    expect(plan.fields.map((field) => field.id)).toEqual(["server", "user", "secret"]);
    expect(plan.other?.replaces).toEqual(["server"]);
    expect(shownConnectFields(plan, true).map((field) => field.id)).toEqual(["user", "filesUrl", "caldavUrl", "secret"]);
    expect(plan.button.key).toBe("connectAccess.button.password");
  });

  it("generic WebDAV: its addresses are the sign-in, nothing to fold away", () => {
    const plan = connectAccessPlan({ family: "webdav", services: ["files"], providerName: "WebDAV" });
    expect(plan.fields.map((field) => field.id)).toEqual(["filesUrl", "user", "secret"]);
    expect(plan.other).toBeNull();
  });

  it("S3: four fields, region, prefix and path style under Advanced, the guide, Verbinden", () => {
    const plan = connectAccessPlan({ family: "s3", services: ["files"], providerName: "S3" });
    expect(plan.fields.map((field) => field.id)).toEqual(["endpoint", "bucket", "accessKeyId", "secret"]);
    expect(plan.fields[3].labelKey).toBe("connectAccess.secret.secretKey");
    expect(plan.other).toMatchObject({ labelKey: "connectAccess.other.advancedLabel", holds: "advanced" });
    expect(plan.other?.fields.map((field) => field.id)).toEqual(["region", "prefix", "pathStyle"]);
    expect(shownConnectFields(plan, true).map((field) => field.id)).toEqual(["endpoint", "bucket", "accessKeyId", "secret", "region", "prefix", "pathStyle"]);
    expect(plan.button.key).toBe("pim.connect");
    expect(plan.summary.key).toBe("connectAccess.summary.keys");
    expect(plan.guide).not.toBeNull();
  });

  it("IMAP: the preset names the secret and its hints - auth code, mail password, Bridge, enable first, Outlook", () => {
    const own = connectAccessPlan({ family: "imap", services: ["mail"], providerName: "IMAP", preset: null });
    expect(own.fields.map((field) => field.id)).toEqual(["email", "mailProvider", "imapHost", "imapPort", "smtpHost", "smtpPort", "secret"]);
    expect(own.other).toBeNull();
    expect(own.secret).toBe("password");
    const gmx = connectAccessPlan({ family: "imap", services: ["mail"], providerName: "IMAP", preset: presetById("gmx") });
    expect(gmx.fields.map((field) => field.id)).toEqual(["email", "secret"]);
    expect(gmx.other?.holds).toBe("servers");
    for (const preset of ["qq", "163"]) {
      const plan = connectAccessPlan({ family: "imap", services: ["mail"], providerName: "IMAP", preset: presetById(preset) });
      if (plan.secret === "authCode") {
        expect(plan.button.key).toBe("connectAccess.button.authCode");
        expect(plan.step?.key).toBe("connectAccess.step.authCode");
      }
    }
    const outlook = connectAccessPlan({ family: "imap", services: ["mail"], providerName: "IMAP", preset: presetById("outlook") });
    expect(outlook.useTileInstead).toBe("microsoft");
    expect(outlook.notes.map((note) => note.key)).toEqual(["cloudAccounts.presetUseMicrosoft"]);
    const proton = connectAccessPlan({ family: "imap", services: ["mail"], providerName: "IMAP", preset: presetById("proton") });
    if (proton.notes.length) expect(proton.notes[0].key).toBe("cloudAccounts.hintBridge");
  });

  it("the device's calendars: a permission, Zugriff erlauben", () => {
    const plan = connectAccessPlan({ family: "device", services: ["calendar"], providerName: "Device" });
    expect(plan.kind).toBe("permission");
    expect(plan.button.key).toBe("connectAccess.button.permission");
    expect(plan.fields).toEqual([]);
  });

  it("the secret of a connected account, for its page and its credentials panel", () => {
    expect(accountSecretOf("s3")).toBe("secretKey");
    expect(connectNewSecretLabelKey("secretKey")).toBe("connectAccess.newSecret.secretKey");
    expect(accountSecretOf("fastmail")).toBe("appPassword");
    expect(accountSecretOf("mailboxorg")).toBe("password");
    expect(accountSecretOf("webdav")).toBe("password");
    expect(accountSecretOf("imap", "imap.gmx.net:993")).toBe(connectSecretOf("imap", presetById("gmx")));
    expect(accountSecretOf("imap", "mail.example.org")).toBe("password");
    expect(accountSecretOf("dropbox")).toBeNull();
  });

  it("required fields gate the button; a prefilled endpoint counts as filled", () => {
    const plan = connectAccessPlan({ family: "fastmail", services: ["files"], providerName: "Fastmail" });
    expect(connectFieldsComplete(plan.fields, { email: "a@b.c" })).toBe(false);
    expect(connectFieldsComplete(plan.fields, { email: "a@b.c", secret: "x" })).toBe(true);
    expect(connectFieldsComplete(shownConnectFields(plan, true), { email: "a@b.c", secret: "x" })).toBe(true);
    expect(connectFieldsComplete(shownConnectFields(plan, true), { email: "a@b.c", secret: "x", filesUrl: " " })).toBe(false);
  });
});

describe("provider list, search and the services step", () => {
  it("Nextcloud is its own entry in the one list", () => {
    expect(CONNECT_PROVIDERS.find((provider) => provider.key === "nextcloud")).toEqual({ key: "nextcloud", family: "webdav", flavor: "nextcloud" });
    expect(CONNECT_PROVIDERS.slice(0, 2).map((provider) => provider.key)).toEqual(["google", "microsoft"]);
  });

  it("the search finds IMAP presets and lands a dead end on its target", () => {
    const label = (provider: { key: string }) => provider.key;
    expect(searchConnectProviders("", label).visible).toHaveLength(CONNECT_PROVIDERS.length);
    const gmx = searchConnectProviders("gmx", label);
    expect(gmx.visible.map((provider) => provider.key)).toEqual(["imap"]);
    expect(gmx.presetHit?.id).toBe("gmx");
    expect(searchConnectProviders("outlook", label).visible.map((provider) => provider.key)).toContain("microsoft");
  });

  it("a service a provider cannot carry is offered off with its reason", () => {
    expect(serviceUnavailableKey("apple", "files")).toBe("cloudAccounts.appleNoFiles");
    expect(serviceUnavailableKey("dropbox", "mail")).toBe("connectAccess.unavailable.mail");
    expect(serviceUnavailableKey("dropbox", "files")).toBeNull();
    for (const service of ["files", "calendar", "mail"] as const) expect(typeof lookup(de, `connectAccess.unavailable.${service}`)).toBe("string");
  });

  it("preselects what the provider can carry, the same in both shells; a side door ticks only its service", () => {
    expect(preselectedServices("fastmail", { filesTaken: false, calendarAvailable: true })).toEqual({ files: true, calendar: true, mail: true });
    expect(preselectedServices("fastmail", { filesTaken: true, calendarAvailable: false })).toEqual({ files: false, calendar: false, mail: true });
    expect(preselectedServices("google", { filesTaken: false, calendarAvailable: true, only: "calendar" })).toEqual({ files: false, calendar: true, mail: false });
    expect(preselectedServices("dropbox", { filesTaken: false, calendarAvailable: true, only: "mail" })).toEqual({ files: false, calendar: false, mail: false });
  });
});

describe("Dropbox app key per device (E6)", () => {
  it("resolves the standard key or the own one; a malformed own key is a problem", () => {
    expect(resolveDropboxAccess(null)).toEqual({ ok: true, access: { family: "dropbox", source: "plainva", clientId: PLAINVA_DROPBOX_APP_KEY } });
    expect(resolveDropboxAccess({ source: "own", clientId: "abcd1234efgh" })).toEqual({ ok: true, access: { family: "dropbox", source: "own", clientId: "abcd1234efgh" } });
    expect(resolveDropboxAccess({ source: "own" })).toEqual({ ok: false, problem: "ownClientMissing" });
    expect(resolveDropboxAccess({ source: "own", clientId: "https://x" })).toEqual({ ok: false, problem: "ownClientInvalid" });
    expect(resolveDropboxAccess(null, "")).toEqual({ ok: false, problem: "noPlainvaClient" });
    expect(validClientId("dropbox", PLAINVA_DROPBOX_APP_KEY)).toBe(true);
  });

  it("takes an account's own key over; Plainva's key written as the account's is the standard sign-in", () => {
    expect(adoptedDropboxAccess([undefined, undefined])).toBeNull();
    expect(adoptedDropboxAccess(["abcd1234efgh"])).toEqual({ source: "own", clientId: "abcd1234efgh" });
    // The old account page wrote the field's value on leaving it - the stored sign-in's key, Plainva's included.
    expect(adoptedDropboxAccess([PLAINVA_DROPBOX_APP_KEY])).toEqual({ source: "plainva" });
    expect(adoptedDropboxAccess([PLAINVA_DROPBOX_APP_KEY, "zzzz9999yyyy"])).toEqual({ source: "own", clientId: "zzzz9999yyyy" });
    // A key that does not look like one is not adopted; nothing is lost - it stays on the account.
    expect(adoptedDropboxAccess(["not a key!"])).toBeNull();
  });
});

describe("connect run before the sign-in", () => {
  it("a run that starts before its sign-in shows the sign-in as the step on screen, not as done", () => {
    expect(connectRunSteps({ pending: ["files"], done: [], signedIn: false }).map((step) => `${step.id}:${step.state}`)).toEqual(["signin:active", "files:pending"]);
    expect(connectRunSteps({ pending: ["files"], done: [] }).map((step) => `${step.id}:${step.state}`)).toEqual(["signin:done", "files:active"]);
  });
});
