// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IDatabaseAdapter } from "@plainva/core";
import { setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { listMailAccounts, mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import { createSerdeSettingsStore, type SerdeSettingsStore } from "../../test-serdeStore";

/**
 * The desktop's notice about mail accounts without a password (finding
 * 2026-09-24, E4), rendered: it appears only for entries without a password
 * and without a fetch, says what is true on THIS device, offers the account's
 * own sign-in first, removes one only after a confirmation that names every
 * device it reaches, and "Later" hides it.
 *
 * The sign-in comes first because the rule cannot see other devices: a
 * mailbox that works on a laptop but was never used here looks exactly like a
 * leftover — and removing it would reach the laptop too, through the sync.
 */

/**
 * A mail cache that accepts its schema and holds no messages: every account
 * here is one that never fetched. The rule itself is tested against real
 * SQLite in the node-environment test of `orphanedMailAccounts`; this render
 * test runs in jsdom, where Vite cannot bundle `node:sqlite` on Node 22 (the
 * CI) — see jsdomNodeBuiltins.test.ts.
 */
class EmptyMailCacheAdapter implements IDatabaseAdapter {
  async execute(): Promise<void> {}
  async query<T>(): Promise<T[]> {
    return [];
  }
  async queryOne<T>(): Promise<T | null> {
    return null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
}

const vaultState = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "C:/vaults/wiki", dbAdapter: vaultState.db, pimRuntime: null }),
  mailFolderKey: (v: string) => `mailFolder_${v}`,
  mailRemoteImagesKey: (v: string) => `mailRemoteImages_${v}`,
  DEFAULT_MAIL_FOLDER: "Mail",
}));
vi.mock("../../services/settingsStore", () => ({ getSettingsStore: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) }));
vi.mock("../../services/deviceSignIn", () => ({ deviceSignInStates: async (_k: string, _v: string, ids: string[]) => new Map(ids.map((id) => [id, "signin"])) }));
vi.mock("../../services/mail/gmailAuth", () => ({ desktopGmailClient: () => null, signInGmail: vi.fn() }));
vi.mock("./RulesSettings", () => ({ RulesSettings: () => null }));
vi.mock("./VacationSettings", () => ({ VacationSettings: () => null }));
vi.mock("./ComposeEditor", () => ({ ComposeEditor: () => null }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../services/appDialogs", () => ({ appConfirm: confirm }));
vi.mock("../../services/cloudAccounts", () => ({
  CLOUD_ACCOUNTS_EVENT: "plainva-cloud-accounts-changed",
  loadCloudAccounts: vi.fn(async () => []),
  refreshCloudAccounts: vi.fn(async () => []),
}));

import { MailAccountsSection, OrphanedMailNotice } from "./MailAccountsSection";

const VAULT = "C:/vaults/wiki";
const account = (id: string): MailAccountConfig => ({ id, label: `${id}@gmail.com`, host: "imap.gmail.com", port: 993, user: `${id}@gmail.com` });

let store: SerdeSettingsStore;
const secrets = new Map<string, unknown>();
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  store = createSerdeSettingsStore();
  secrets.clear();
  confirm.mockClear();
  vaultState.db = new EmptyMailCacheAdapter();
  setPlatformServices({
    loadSettings: async () => store,
    credentials: {
      readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
      writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
    openExternal: async () => {},
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (onRemoved = vi.fn(), onSignIn = vi.fn()) => {
  await act(async () => {
    root.render(<OrphanedMailNotice vaultPath={VAULT} reloadToken={0} onRemoved={onRemoved} onSignIn={onSignIn} />);
  });
  await act(async () => {});
  await act(async () => {});
};

const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
};

describe("the notice about mail accounts without a password, on the desktop", () => {
  it("stays away while every account works", async () => {
    await store.set(mailAccountsKey(VAULT), [account("working")]);
    secrets.set(mailSecretKey(VAULT, "working"), { pass: "pw" });
    await render();
    expect(container.textContent).toBe("");
  });

  it("names the entries, lists them on View and removes one after the question", async () => {
    await store.set(mailAccountsKey(VAULT), [account("working"), account("orphan")]);
    secrets.set(mailSecretKey(VAULT, "working"), { pass: "pw" });
    const onRemoved = vi.fn();
    await render(onRemoved);
    expect(container.textContent).toContain("1 email account without a password on this device");
    expect(container.textContent).toContain("Remove deletes the entry on all devices");
    expect(container.querySelector('[data-testid="mail-orphan"]')).toBeNull();

    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const rows = container.querySelectorAll('[data-testid="mail-orphan"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("orphan@gmail.com");
    expect(rows[0].textContent).toContain("without password · imap.gmail.com");

    await click(container.querySelector('[data-testid="mail-orphan-remove"]'));
    expect(confirm).toHaveBeenCalledTimes(1);
    // The question names what the removal reaches, and the alternative.
    const [{ title, message }] = confirm.mock.calls[0] as unknown as [{ title: string; message: string }];
    expect(title).toBe("Remove this email account on all devices?");
    expect(message).toContain("every device that syncs this vault's settings");
    expect(message).toContain("sign in here instead");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
    expect(onRemoved).toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("offers the mailbox's own sign-in beside Remove, and removes nothing for it", async () => {
    await store.set(mailAccountsKey(VAULT), [account("elsewhere")]);
    const onSignIn = vi.fn();
    await render(vi.fn(), onSignIn);
    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const signIn = container.querySelector('[data-testid="mail-orphan-signin"]');
    expect(signIn?.textContent).toBe("Sign in on this device");
    await click(signIn);
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: "elsewhere" }));
    expect(confirm).not.toHaveBeenCalled();
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["elsewhere"]);
  });

  /**
   * On the real page the action lands in the mailbox's OWN sign-in: the row's
   * password field opens (IMAP), or Cloud accounts for a Microsoft mailbox —
   * the flows every unsigned mailbox already offers.
   */
  it("opens the mailbox's own password field on the page, or Cloud accounts for Microsoft", async () => {
    const microsoft: MailAccountConfig = { id: "ms", label: "me@outlook.com", host: "", port: 0, user: "me@outlook.com", kind: "microsoft" };
    await store.set(mailAccountsKey(VAULT), [account("elsewhere"), microsoft]);
    const openCloud = vi.fn();
    await act(async () => {
      root.render(<MailAccountsSection onOpenCloudAccounts={openCloud} />);
    });
    for (let i = 0; i < 4; i++) await act(async () => {});
    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    expect(container.querySelector('[data-testid="mail-signin-password"]')).toBeNull();
    const [imapSignIn, msSignIn] = container.querySelectorAll('[data-testid="mail-orphan-signin"]');
    await click(imapSignIn);
    expect(container.querySelector('[data-testid="mail-signin-password"]')).not.toBeNull();
    await click(msSignIn);
    expect(openCloud).toHaveBeenCalledWith("ms");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("removes nothing when the question is declined", async () => {
    confirm.mockResolvedValueOnce(false);
    await store.set(mailAccountsKey(VAULT), [account("orphan")]);
    await render();
    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    await click(container.querySelector('[data-testid="mail-orphan-remove"]'));
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["orphan"]);
  });

  it("hides on Later and stays hidden for the same entries", async () => {
    await store.set(mailAccountsKey(VAULT), [account("orphan")]);
    await render();
    await click(container.querySelector('[data-testid="mail-orphans-later"]'));
    expect(container.textContent).toBe("");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toBe("");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["orphan"]);
  });
});
