// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE SLOT PER PUBLICATION (stage B, S4b shells).
 *
 * A publication carries its own workspace: its own device key, its own group
 * keys, its own policy. Those may not live in the vault's slot — a recipient of
 * one publication would otherwise sit on the key bundle of every other. So the
 * credential store gains a slot per publication, and this file pins the three
 * things that make that safe rather than merely present:
 *
 *  - the slot name carries BOTH ids, because the OS keychain cannot be
 *    enumerated afterwards to find a collision that already happened;
 *  - a locked vault locks its publications AND drops their keys out of memory,
 *    since the publisher's bundle is the admin half (invite, revoke), strictly
 *    more than any recipient may do;
 *  - without a session key the passphrase branch REFUSES rather than writing a
 *    readable bundle — a silent plaintext fallback would be the whole point of
 *    the feature, lost quietly.
 */

const secrets = new Map<string, unknown>();
let keychainStatus: "native" | "unavailable" = "native";

vi.mock("../CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => {
      secrets.set(key, value);
    },
    removeSecret: async (key: string) => {
      secrets.delete(key);
    },
    checkKeychainStatus: async () => keychainStatus,
  },
}));
vi.mock("../settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async () => undefined,
    set: async () => {},
    save: async () => {},
  }),
}));

import {
  createPersonalWorkspaceBootstrap,
  personalWorkspaceRuntime,
  type PersonalWorkspaceRuntime,
} from "@plainva/core";
import {
  clearPublicationRuntimes,
  lockWorkspaceRuntime,
  persistPublicationRuntime,
  persistWorkspaceRuntime,
  readPublicationRuntime,
} from "./workspaceKeychain";

const VAULT_A = "/vault-a";
const VAULT_B = "/vault-b";
const PUB = "pub-quarterly";

async function freshRuntime(): Promise<PersonalWorkspaceRuntime> {
  const bootstrap = await createPersonalWorkspaceBootstrap({
    ownerDisplayName: "Owner",
    deviceDisplayName: "Desk",
    platform: "desktop",
    minimumClientVersion: "0.5.0",
  });
  return personalWorkspaceRuntime(bootstrap);
}

/** Puts a vault runtime in the slot so the vault counts as set up and unlocked. */
async function openVault(vaultPath: string): Promise<PersonalWorkspaceRuntime> {
  const runtime = await freshRuntime();
  await persistWorkspaceRuntime({
    vaultPath,
    runtime,
    fingerprint: "ff".repeat(16),
    recoveryConfirmedAt: "2026-08-30T08:00:00.000Z",
  });
  return runtime;
}

describe("publication runtimes in the credential store", () => {
  beforeEach(() => {
    secrets.clear();
    keychainStatus = "native";
    lockWorkspaceRuntime(VAULT_A);
    lockWorkspaceRuntime(VAULT_B);
  });

  it("round-trips a publication runtime and reports an unknown one as absent", async () => {
    await openVault(VAULT_A);
    const pub = await freshRuntime();
    await persistPublicationRuntime(VAULT_A, PUB, pub);

    const read = await readPublicationRuntime(VAULT_A, PUB);
    expect(read.state).toBe("unlocked");
    expect(read.state === "unlocked" && read.runtime.workspaceId).toBe(pub.workspaceId);

    // "never published" and "cannot open it right now" are different answers and
    // must stay so; a caller that conflates them offers the wrong repair.
    expect((await readPublicationRuntime(VAULT_A, "pub-unknown")).state).toBe("absent");
  });

  it("keys the slot by vault AND publication, so two vaults never share one", async () => {
    await openVault(VAULT_A);
    await openVault(VAULT_B);
    const a = await freshRuntime();
    const b = await freshRuntime();
    await persistPublicationRuntime(VAULT_A, PUB, a);
    await persistPublicationRuntime(VAULT_B, PUB, b);

    const readA = await readPublicationRuntime(VAULT_A, PUB);
    const readB = await readPublicationRuntime(VAULT_B, PUB);
    expect(readA.state === "unlocked" && readA.runtime.workspaceId).toBe(a.workspaceId);
    expect(readB.state === "unlocked" && readB.runtime.workspaceId).toBe(b.workspaceId);
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(secrets.size).toBe(4); // two vault slots, two publication slots
  });

  it("locks its publications with the vault and takes their keys out of memory", async () => {
    await openVault(VAULT_A);
    const pub = await freshRuntime();
    const signing = pub.device.secrets.signing.privateKey;
    await persistPublicationRuntime(VAULT_A, PUB, pub);
    expect((await readPublicationRuntime(VAULT_A, PUB)).state).toBe("unlocked");

    lockWorkspaceRuntime(VAULT_A);

    expect((await readPublicationRuntime(VAULT_A, PUB)).state).toBe("locked");
    // Not just refused — gone. The read guard alone would satisfy the line above
    // while the publisher's admin key still sat in a heap the user believes
    // they closed.
    expect(signing.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses to seal without a session key rather than writing a readable bundle", async () => {
    keychainStatus = "unavailable";
    await persistWorkspaceRuntime({
      vaultPath: VAULT_A,
      runtime: await freshRuntime(),
      fingerprint: "ff".repeat(16),
      recoveryConfirmedAt: "2026-08-30T08:00:00.000Z",
      fallbackPassphrase: "correct horse battery staple",
    });
    const pub = await freshRuntime();
    await persistPublicationRuntime(VAULT_A, PUB, pub);
    expect((await readPublicationRuntime(VAULT_A, PUB)).state).toBe("unlocked");

    // Locking drops the session key; a later publish must not fall back to plain.
    lockWorkspaceRuntime(VAULT_A);
    await expect(persistPublicationRuntime(VAULT_A, "pub-two", await freshRuntime())).rejects.toThrow(
      "workspace-passphrase-required",
    );
    expect(secrets.has(`workspace_pub_v1_${btoa(VAULT_A)}_pub-two`)).toBe(false);
  });

  it("removes exactly the publications it is handed", async () => {
    await openVault(VAULT_A);
    await persistPublicationRuntime(VAULT_A, PUB, await freshRuntime());
    await persistPublicationRuntime(VAULT_A, "pub-second", await freshRuntime());

    await clearPublicationRuntimes(VAULT_A, [PUB]);

    expect((await readPublicationRuntime(VAULT_A, PUB)).state).toBe("absent");
    expect((await readPublicationRuntime(VAULT_A, "pub-second")).state).toBe("unlocked");
  });
});
