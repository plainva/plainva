// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatabaseSync } from "node:sqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { listMailAccounts, mailAccountsKey, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import { createSerdeSettingsStore, type SerdeSettingsStore } from "../../test-serdeStore";

/**
 * The desktop's notice about incomplete mail accounts (finding 2026-09-24, E4),
 * rendered: it appears only for entries without a password and without a
 * fetch, lists them on "View", removes one only after the confirmation, and
 * "Later" hides it.
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

const vaultState = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../contexts/VaultContext", () => ({ useVault: () => ({ dbAdapter: vaultState.db, pimRuntime: null }) }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../services/appDialogs", () => ({ appConfirm: confirm }));
vi.mock("../../services/cloudAccounts", () => ({
  CLOUD_ACCOUNTS_EVENT: "plainva-cloud-accounts-changed",
  loadCloudAccounts: vi.fn(async () => []),
  refreshCloudAccounts: vi.fn(async () => []),
}));

import { OrphanedMailNotice } from "./MailAccountsSection";

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
  vaultState.db = new NodeSqliteAdapter();
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

const render = async (onRemoved = vi.fn()) => {
  await act(async () => {
    root.render(<OrphanedMailNotice vaultPath={VAULT} reloadToken={0} onRemoved={onRemoved} />);
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

describe("the incomplete-mail-accounts notice on the desktop", () => {
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
    expect(container.textContent).toContain("1 incomplete email account");
    expect(container.querySelector('[data-testid="mail-orphan"]')).toBeNull();

    await click(container.querySelector('[data-testid="mail-orphans-review"]'));
    const rows = container.querySelectorAll('[data-testid="mail-orphan"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("orphan@gmail.com");
    expect(rows[0].textContent).toContain("without password · imap.gmail.com");

    await click(container.querySelector('[data-testid="mail-orphan-remove"]'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((await listMailAccounts(VAULT)).map((a) => a.id)).toEqual(["working"]);
    expect(onRemoved).toHaveBeenCalled();
    expect(container.textContent).toBe("");
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
