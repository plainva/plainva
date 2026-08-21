import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  caldavUrlFromFiles,
  clearConnectSecrets,
  getConnectSecrets,
  rememberConnectSecrets,
} from "./services/connectSecrets";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The connect wizard, from step 2 onwards (finding 2026-08-21).
 *
 * The maintainer's report was three symptoms — provider chooser folds back out,
 * Google asks for the client id again, mail lands on the generic IMAP form —
 * and one cause: the family stopped travelling after the first hop. The prefill
 * table (`familyTarget.ts`) was never wrong, it was never reached.
 */
describe("a run keeps its provider on every hop", () => {
  /**
   * A source guard rather than a rendered test on purpose: the push happens in
   * an event handler inside a hook that only runs inside the shell, and what
   * has to hold is one property on the entry. Red counter-check: dropping
   * `family` from the pushEntry call fails this.
   */
  it("pushes the next screen WITH the family", () => {
    const src = read("./hooks/useConnectRun.ts");
    const push = /setNav\(\(st\) => pushEntry\(st, \{([^}]*)\}\)\)/.exec(src);
    expect(push, "the run still pushes the next screen").not.toBeNull();
    expect(push![1]).toContain("family: queue?.family");
  });

  /** Every screen the run can open must read the family it is handed. */
  it("has all three target screens read the family", () => {
    for (const file of [
      "./AddVaultScreen.tsx",
      "./screens/PimAccountsScreen.tsx",
      "./screens/MailAccountsScreen.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} reads the family`).toMatch(/family\?: CloudProviderFamily/);
      expect(src, `${file} asks the shared prefill table`).toMatch(/TargetForFamily\(family\)/);
    }
  });
});

describe("credentials collected by one step reach the next", () => {
  beforeEach(() => clearConnectSecrets());

  it("merges what a step collected, and an empty field never wins", () => {
    rememberConnectSecrets({ baseUrl: "https://cloud.example.com/remote.php/dav/files/ada/", user: "ada" });
    rememberConnectSecrets({ password: "  app-pw  ", user: "   " });
    expect(getConnectSecrets()).toEqual({
      baseUrl: "https://cloud.example.com/remote.php/dav/files/ada/",
      user: "ada",
      password: "app-pw",
    });
  });

  it("keeps nothing once the run ends", () => {
    rememberConnectSecrets({ password: "app-pw" });
    clearConnectSecrets();
    expect(getConnectSecrets()).toEqual({});
  });

  /**
   * The run must not outlive itself. `persist(null)` is the single point where
   * a queue disappears — cancelled, expired or finished — so the teardown hangs
   * there rather than on each of the three call sites.
   */
  it("is cleared wherever the queue is dropped", () => {
    const src = read("./services/connectQueue.ts");
    const persist = /async function persist\([^)]*\): Promise<void> \{([\s\S]*?)\n\}/.exec(src);
    expect(persist).not.toBeNull();
    expect(persist![1]).toContain("clearConnectSecrets()");
  });

  it("derives the CalDAV endpoint from a Nextcloud file URL", () => {
    expect(caldavUrlFromFiles("https://cloud.example.com/remote.php/dav/files/ada/Vault", "ada")).toBe(
      "https://cloud.example.com/remote.php/dav",
    );
  });

  /** A guessed path looks answered, which is worse than an empty field. */
  it("stays silent for anything that is not a Nextcloud file root", () => {
    expect(caldavUrlFromFiles("https://webdav.fastmail.com", "ada@example.com")).toBeNull();
    expect(caldavUrlFromFiles(undefined, "ada")).toBeNull();
    expect(caldavUrlFromFiles("https://cloud.example.com/remote.php/dav/files/ada/", undefined)).toBeNull();
  });
});

describe("the add-calendar form asks the device for a client id", () => {
  beforeEach(() => vi.resetModules());

  const mockChain = (opts: { sync?: unknown; token?: unknown; throws?: boolean }) => {
    vi.doMock("./services/vaultRegistry", () => ({
      getActiveVaultEntry: async () => {
        if (opts.throws) throw new Error("no vault");
        return { id: "v1" };
      },
    }));
    vi.doMock("./services/cloudAccountsStore", () => ({ loadCloudAccounts: async () => [{ id: "a1", family: "google" }] }));
    vi.doMock("./services/accountBroker", () => ({ getAccountToken: async () => opts.token ?? null }));
    vi.doMock("./services/syncService", () => ({ getStoredProvider: async () => opts.sync ?? null }));
    vi.doMock("./services/pim/pimService", () => ({ listPimAccounts: async () => [] }));
    vi.doMock("./services/pim/pimCredentials", () => ({ getPimCredentials: async () => null }));
  };

  /**
   * The case the maintainer met: step 1 connected Google Drive with a BYO
   * client id, step 2 demanded it again although it sat in the file-sync
   * credentials of the vault the run had just created.
   */
  it("finds the client id the file sync of this vault already uses", async () => {
    mockChain({ sync: { provider: "drive", creds: { clientId: "drive-client", clientSecret: "s" } } });
    const { lookupOAuthClientForNewAccount } = await import("./services/pim/pimClientLookup");
    await expect(lookupOAuthClientForNewAccount("google")).resolves.toEqual({
      clientId: "drive-client",
      clientSecret: "s",
    });
  });

  it("does not hand a Drive client to Microsoft", async () => {
    mockChain({ sync: { provider: "drive", creds: { clientId: "drive-client" } } });
    const { lookupOAuthClientForNewAccount } = await import("./services/pim/pimClientLookup");
    await expect(lookupOAuthClientForNewAccount("microsoft")).resolves.toBeNull();
  });

  /** Nothing to find means the form asks — never an error the user sees. */
  it("returns null when there is nothing on the device", async () => {
    mockChain({});
    const { lookupOAuthClientForNewAccount } = await import("./services/pim/pimClientLookup");
    await expect(lookupOAuthClientForNewAccount("google")).resolves.toBeNull();
  });

  it("survives a source that throws", async () => {
    mockChain({ throws: true });
    const { lookupOAuthClientForNewAccount } = await import("./services/pim/pimClientLookup");
    await expect(lookupOAuthClientForNewAccount("google")).resolves.toBeNull();
  });

  /** The button must not be gated on a field the chain is about to fill. */
  it("does not gate Connect on the client-id field", () => {
    const src = read("./screens/PimAccountsScreen.tsx");
    expect(src).not.toMatch(/disabled=\{busy \|\| !gClientId\.trim\(\)\}/);
    expect(src).toContain("lookupOAuthClientForNewAccount");
    expect(src).toContain('data-testid="pim-client-from-device"');
  });
});
