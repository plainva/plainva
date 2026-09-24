// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IDatabaseAdapter } from "@plainva/core";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { listMailAccounts, mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * The phone's side of the notice about mail accounts without a password
 * (finding 2026-09-24, E4). The entries were created on the desktop and arrive
 * here with the settings sync, so the phone offers the same clean-up: the same
 * rule, the same sentences, one confirmed tap per entry — and the account's own
 * sign-in first, because a mailbox that works on another device looks exactly
 * like a leftover from here, and removing it would reach that device too.
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

const VAULT = "vault-1";
const values = new Map<string, unknown>();
const secrets = new Map<string, unknown>();

vi.mock("./services/mail/mailRuntime", async () => {
  const mail = await import("@plainva/ui/mail");
  return {
    MAIL_CHANGED_EVENT: "m-mail-changed",
    connectMicrosoftMail: vi.fn(),
    listMobileMailAccounts: vi.fn(async () => mail.listMailAccounts("vault-1")),
    mailVaultId: () => "vault-1",
    notifyMailChanged: vi.fn(),
    removeMobileMailAccount: vi.fn(),
  };
});
vi.mock("./services/deviceSignIn", () => ({ deviceSignInStates: vi.fn(async () => new Map()) }));
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ mailFolder: "Mail" }),
  updateMobileSettings: vi.fn(async () => {}),
}));
vi.mock("./adapters/mailNet", () => ({ hasNativeMailSocket: () => true }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: confirm, mPrompt: vi.fn(), mSelect: vi.fn() }));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMailRules: vi.fn(async () => []),
}));

import { MailAccountsScreen } from "./screens/MailAccountsScreen";

const account = (id: string): MailAccountConfig => ({ id, label: `${id}@gmail.com`, host: "imap.gmail.com", port: 993, user: `${id}@gmail.com` });

let container: HTMLDivElement;
let root: Root;
let db: EmptyMailCacheAdapter;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  values.clear();
  secrets.clear();
  confirm.mockClear();
  db = new EmptyMailCacheAdapter();
  const store: ISettingsStore = {
    get: async <T,>(key: string) => values.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    delete: async (key: string) => values.delete(key),
    keys: async () => [...values.keys()],
    save: async () => {},
  };
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

const render = async () => {
  await act(async () => {
    root.render(<MailAccountsScreen bump={0} vault={{ vaultId: VAULT, db } as never} />);
  });
  for (let i = 0; i < 4; i++) await act(async () => {});
};

const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
};

describe("the notice about mail accounts without a password, on the phone", () => {
  it("does not appear while every account works", async () => {
    values.set(mailAccountsKey(VAULT), [account("working")]);
    secrets.set(mailSecretKey(VAULT, "working"), { pass: "pw" });
    await render();
    expect(container.querySelector('[data-testid="mail-orphans-review"]')).toBeNull();
  });

  it("lists the entries a desktop setup left behind and removes one after the question", async () => {
    values.set(mailAccountsKey(VAULT), [account("working"), account("orphan")]);
    secrets.set(mailSecretKey(VAULT, "working"), { pass: "pw" });
    await render();
    expect(container.textContent).toContain("1 email account without a password on this device");
    expect(container.textContent).toContain("Remove deletes the entry on all devices");

    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const row = container.querySelector('[data-testid="mail-orphan-orphan"]');
    expect(row?.textContent).toContain("without password · imap.gmail.com");

    await click(container.querySelector('[data-testid="mail-orphan-remove-orphan"]'));
    expect(confirm).toHaveBeenCalledTimes(1);
    const [{ title, message }] = confirm.mock.calls[0] as unknown as [{ title: string; message: string }];
    expect(title).toBe("Remove this email account on all devices?");
    expect(message).toContain("every device that syncs this vault's settings");
    expect(message).toContain("sign in here instead");
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
    expect(container.querySelector('[data-testid="mail-orphans-review"]')).toBeNull();
  });

  it("offers the mailbox's own sign-in: the password form of that account, nothing removed", async () => {
    values.set(mailAccountsKey(VAULT), [account("elsewhere")]);
    await render();
    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const signIn = container.querySelector('[data-testid="mail-orphan-signin-elsewhere"]');
    expect(signIn?.textContent).toBe("Sign in on this device");
    await click(signIn);
    // The same IMAP form the edit button opens, pointed at that account.
    expect(container.querySelector(".m-sheet")).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]')?.value).toBe("elsewhere@gmail.com");
    expect(confirm).not.toHaveBeenCalled();
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["elsewhere"]);
  });

  it("hides on Later without removing anything", async () => {
    values.set(mailAccountsKey(VAULT), [account("orphan")]);
    await render();
    await click(container.querySelector('[data-testid="mail-orphans-later"]'));
    expect(container.querySelector('[data-testid="mail-orphans-review"]')).toBeNull();
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["orphan"]);
  });
});
