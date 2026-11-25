// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { confirmEndpointsIn, isEndpointConfirmedIn, mailConfirmationEndpoint, setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMailPassword, listMailAccounts, mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import { createSerdeSettingsStore, type SerdeSettingsStore } from "../../test-serdeStore";

/**
 * The servers of an IMAP mailbox, changed on the desktop from its row
 * (review 2026-11-25) — the phone's edit form as a dialog, through the same
 * shared form and save. The address rule of that form (review of F57, O3):
 * a server changed in the dialog is typed, and the save confirms it; one the
 * dialog came with, unchanged, is not, and the password goes to it only when
 * this device confirmed it before. (Only a server on a private network needs
 * confirming: the hosts here are such servers.)
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "C:/vaults/wiki", dbAdapter: null, pimRuntime: null }),
  mailFolderKey: (v: string) => `mailFolder_${v}`,
  mailRemoteImagesKey: (v: string) => `mailRemoteImages_${v}`,
  DEFAULT_MAIL_FOLDER: "Mail",
}));
vi.mock("../../services/settingsStore", () => ({ getSettingsStore: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) }));
vi.mock("../../services/deviceSignIn", () => ({ deviceSignInStates: async (_k: string, _v: string, ids: string[]) => new Map(ids.map((id) => [id, "active"])) }));
vi.mock("./RulesSettings", () => ({ RulesSettings: () => null }));
vi.mock("./VacationSettings", () => ({ VacationSettings: () => null }));
vi.mock("./ComposeEditor", () => ({ ComposeEditor: () => null }));
vi.mock("../../services/appDialogs", () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock("../../services/cloudAccounts", () => ({
  CLOUD_ACCOUNTS_EVENT: "plainva-cloud-accounts-changed",
  loadCloudAccounts: vi.fn(async () => []),
  refreshCloudAccounts: vi.fn(async () => []),
}));
const logins = vi.hoisted(() => [] as Array<{ host: string; port: number; user: string; pass: string }>);
vi.mock("../../../../../packages/ui/src/mail/mailClient", async (original) => ({
  ...(await original<typeof import("../../../../../packages/ui/src/mail/mailClient")>()),
  checkMailLogin: vi.fn(async (account: { host: string; port: number; user: string }, pass: string) => {
    logins.push({ host: account.host, port: account.port, user: account.user, pass });
    return [];
  }),
}));

import { MailAccountsSection } from "./MailAccountsSection";

const VAULT = "C:/vaults/wiki";
const mailbox: MailAccountConfig = { id: "m1", label: "anna@example.com", host: "192.168.1.20", port: 993, user: "anna@example.com", smtpHost: "192.168.1.21", smtpPort: 587, kind: "imap" };

let store: SerdeSettingsStore;
const secrets = new Map<string, unknown>();
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  store = createSerdeSettingsStore();
  secrets.clear();
  logins.length = 0;
  setPlatformServices({
    loadSettings: async () => store,
    credentials: {
      readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
      writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => {},
  });
  await store.set(mailAccountsKey(VAULT), [mailbox]);
  secrets.set(mailSecretKey(VAULT, "m1"), { pass: "stored-pw" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
const click = async (selector: string) => {
  const el = document.querySelector(selector) as HTMLElement | null;
  expect(el, selector).not.toBeNull();
  await act(async () => el!.click());
  await settle();
};
const type = async (selector: string, value: string) => {
  const el = document.querySelector(selector) as HTMLInputElement | null;
  expect(el, selector).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const valueOf = (selector: string) => (document.querySelector(selector) as HTMLInputElement).value;

async function openDialog() {
  await act(async () => root.render(<MailAccountsSection />));
  await settle();
  await click('[data-testid="mail-account-edit-m1"]');
}

describe("desktop: a mailbox's servers, changed from its row", () => {
  it("opens with the mailbox's servers, and a changed server is typed: the save confirms it and keeps the stored password", async () => {
    // The servers it came with were confirmed on this device before.
    await confirmEndpointsIn(VAULT, [mailConfirmationEndpoint("imap", "192.168.1.20", 993), mailConfirmationEndpoint("smtp", "192.168.1.21", 587)]);
    await openDialog();
    expect([valueOf('[data-testid="mail-servers-host"]'), valueOf('[data-testid="mail-servers-port"]'), valueOf('[data-testid="mail-servers-smtpHost"]'), valueOf('[data-testid="mail-servers-smtpPort"]')]).toEqual([
      "192.168.1.20",
      "993",
      "192.168.1.21",
      "587",
    ]);
    expect(valueOf('[data-testid="mail-servers-pass"]')).toBe("");
    await type('[data-testid="mail-servers-host"]', "192.168.1.30");
    await click('[data-testid="mail-servers-save"]');

    expect(logins).toEqual([{ host: "192.168.1.30", port: 993, user: "anna@example.com", pass: "stored-pw" }]);
    expect((await listMailAccounts(VAULT)).map((a) => [a.id, a.host, a.smtpHost])).toEqual([["m1", "192.168.1.30", "192.168.1.21"]]);
    expect(await getMailPassword(VAULT, "m1")).toBe("stored-pw");
    expect(await isEndpointConfirmedIn(VAULT, mailConfirmationEndpoint("imap", "192.168.1.30", 993))).toBe(true);
    expect(document.querySelector('[data-testid="mail-servers"]')).toBeNull();
  });

  it("a server the dialog came with, unchanged and not confirmed here, gets no password: nothing is sent or saved", async () => {
    // Servers this device never confirmed, beside one it did (a vault without
    // any record yet takes every address as its own: the switch-over of F57).
    await confirmEndpointsIn(VAULT, [mailConfirmationEndpoint("imap", "192.168.1.50", 993)]);
    await store.set(mailAccountsKey(VAULT), [{ ...mailbox, host: "192.168.1.40", smtpHost: "192.168.1.41" }]);
    await openDialog();
    // The dialog asks first, as the row does.
    expect(document.querySelector('[data-testid="mail-servers-confirm"]')).not.toBeNull();
    await type('[data-testid="mail-servers-pass"]', "typed-pw");
    await click('[data-testid="mail-servers-save"]');

    expect(logins).toEqual([]);
    expect(await getMailPassword(VAULT, "m1")).toBe("stored-pw");
    expect(await isEndpointConfirmedIn(VAULT, mailConfirmationEndpoint("imap", "192.168.1.40", 993))).toBe(false);
    expect(document.querySelector('[data-testid="mail-servers-error"]')?.textContent).toBeTruthy();
  });

  it("is offered on an IMAP mailbox only", async () => {
    await store.set(mailAccountsKey(VAULT), [mailbox, { id: "ms", label: "bert@outlook.example", host: "", port: 0, user: "bert@outlook.example", kind: "microsoft" }]);
    await act(async () => root.render(<MailAccountsSection />));
    await settle();
    expect(document.querySelector('[data-testid="mail-account-edit-m1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mail-account-edit-ms"]')).toBeNull();
  });
});
