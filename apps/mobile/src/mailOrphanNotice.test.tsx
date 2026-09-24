// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatabaseSync } from "node:sqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { listMailAccounts, mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * The phone's side of the incomplete-mail-accounts notice (finding
 * 2026-09-24, E4). The entries were created on the desktop and arrive here with
 * the settings sync, so the phone has to offer the same clean-up: the same
 * rule, the same sentences, one confirmed tap per entry.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
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
let db: NodeSqliteAdapter;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  values.clear();
  secrets.clear();
  confirm.mockClear();
  db = new NodeSqliteAdapter();
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

describe("the incomplete-mail-accounts notice on the phone", () => {
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
    expect(container.textContent).toContain("1 incomplete email account");

    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const row = container.querySelector('[data-testid="mail-orphan-orphan"]');
    expect(row?.textContent).toContain("without password · imap.gmail.com");

    await click(row!.querySelector("button"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
    expect(container.querySelector('[data-testid="mail-orphans-review"]')).toBeNull();
  });

  it("hides on Later without removing anything", async () => {
    values.set(mailAccountsKey(VAULT), [account("orphan")]);
    await render();
    await click(container.querySelector('[data-testid="mail-orphans-later"]'));
    expect(container.querySelector('[data-testid="mail-orphans-review"]')).toBeNull();
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["orphan"]);
  });
});
