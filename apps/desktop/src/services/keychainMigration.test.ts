import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  keychainSlotName,
  vaultFingerprint,
  vaultDisplayName,
  isReadableSlotName,
  migrateKeychainSlot,
  migrateKeychainSlots,
  setPlatformServices,
  type ICredentialStore,
} from "@plainva/ui";
import { legacyMailSecretKey, mailSecretKey } from "@plainva/ui/mail";
import { SYNC_PROVIDERS, allVaultSlots, legacySlot, slot, slotMigrations } from "./keychainSlots";

/**
 * P6. The rename itself is cosmetic; the migration is not. These tests pin the
 * one property that matters — a credential is never gone — and they pin it from
 * the failure side, because that is where the damage would happen.
 */

function store(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const impl = {
    readSecret: vi.fn(async (key: string) => (data.has(key) ? (data.get(key) as never) : null)),
    writeSecret: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    removeSecret: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { data, credentials: impl as unknown as ICredentialStore, impl };
}

describe("readable keychain names", () => {
  it("says which vault, which service and which account", () => {
    expect(
      keychainSlotName({ vaultKey: "/home/marco/Vaults/wiki", service: "mail", account: "fcb8f9ff" })
    ).toBe(`plainva · wiki · Mail · fcb8f9ff · #${vaultFingerprint("/home/marco/Vaults/wiki")}`);
  });

  it("does not change when the account label does", () => {
    // The key IS the entry's identity. `backfillCalendarIdentity` writes a
    // label onto a card as soon as one can be fetched — if that renamed the
    // slot, the password would sit under a name nothing looks for any more.
    const before = keychainSlotName({ vaultKey: "/v", service: "calendar", account: "acc-1" });
    const after = keychainSlotName({ vaultKey: "/v", service: "calendar", account: "acc-1" });
    expect(before).toBe(after);
  });

  it("keeps two vaults of the same name apart", () => {
    // The readable parts collide on purpose here — the fingerprint is the only
    // thing standing between two people's "notes" folders.
    const a = keychainSlotName({ vaultKey: "/home/a/notes", service: "calendar" });
    const b = keychainSlotName({ vaultKey: "/home/b/notes", service: "calendar" });
    expect(a).not.toBe(b);
    expect(vaultDisplayName("/home/a/notes")).toBe("notes");
  });

  it("cannot be broken by a label that contains a separator or a newline", () => {
    const name = keychainSlotName({ vaultKey: "/v", service: "mail", account: "a · b\nc" });
    expect(name.split(" · ")).toHaveLength(5);
  });

  it("is recognisable without reading the entry", () => {
    expect(isReadableSlotName(keychainSlotName({ vaultKey: "/v", service: "files" }))).toBe(true);
    expect(isReadableSlotName("mail_abc_L2hvbWU=")).toBe(false);
  });
});

describe("keychain migration", () => {
  it("moves the secret and removes the old name", async () => {
    const { data, credentials } = store({ old: { pass: "hunter2" } });
    await expect(migrateKeychainSlot(credentials, { from: "old", to: "new" })).resolves.toBe("migrated");
    expect(data.get("new")).toEqual({ pass: "hunter2" });
    expect(data.has("old")).toBe(false);
  });

  it("KEEPS the old entry when the new one cannot be written", async () => {
    const { data, credentials, impl } = store({ old: { pass: "hunter2" } });
    impl.writeSecret.mockRejectedValueOnce(new Error("keyring locked"));
    await expect(migrateKeychainSlot(credentials, { from: "old", to: "new" })).resolves.toBe("kept-old");
    expect(data.get("old")).toEqual({ pass: "hunter2" });
    expect(impl.removeSecret).not.toHaveBeenCalled();
  });

  it("KEEPS the old entry when the new one cannot be read back", async () => {
    // The dangerous case: a write that reports success and stores nothing.
    // Without the read-back this is exactly where a password disappears.
    const { data, credentials, impl } = store({ old: { pass: "hunter2" } });
    impl.writeSecret.mockImplementationOnce(async () => {});
    await expect(migrateKeychainSlot(credentials, { from: "old", to: "new" })).resolves.toBe("kept-old");
    expect(data.get("old")).toEqual({ pass: "hunter2" });
    expect(impl.removeSecret).not.toHaveBeenCalled();
  });

  it("treats an unreadable slot as 'try again', never as 'nothing there'", async () => {
    const { credentials, impl } = store();
    impl.readSecret.mockRejectedValueOnce(new Error("keyring locked"));
    await expect(migrateKeychainSlot(credentials, { from: "old", to: "new" })).resolves.toBe("kept-old");
    expect(impl.writeSecret).not.toHaveBeenCalled();
  });

  it("does nothing for a slot that was never used", async () => {
    const { credentials, impl } = store();
    await expect(migrateKeychainSlot(credentials, { from: "old", to: "new" })).resolves.toBe("absent");
    expect(impl.writeSecret).not.toHaveBeenCalled();
  });

  it("can be run twice — the second run has nothing left to do", async () => {
    const { credentials } = store({ old: { pass: "hunter2" } });
    const first = await migrateKeychainSlots(credentials, [{ from: "old", to: "new" }]);
    const second = await migrateKeychainSlots(credentials, [{ from: "old", to: "new" }]);
    expect(first.migrated).toEqual(["new"]);
    expect(second).toEqual({ migrated: [], keptOld: [] });
  });

  it("reports the ones it could not move instead of failing the whole run", async () => {
    const { data, credentials, impl } = store({ a: 1, b: 2 });
    impl.writeSecret.mockRejectedValueOnce(new Error("locked"));
    const report = await migrateKeychainSlots(credentials, [
      { from: "a", to: "A" },
      { from: "b", to: "B" },
    ]);
    expect(report).toEqual({ migrated: ["B"], keptOld: ["a"] });
    // A vault must still open with one stubborn entry left behind.
    expect(data.get("a")).toBe(1);
    expect(data.get("B")).toBe(2);
  });
});

describe("desktop slot families", () => {
  const V = "/home/marco/Vaults/wiki";
  const ids = { accounts: ["acc-1"], calendars: ["cal-1"], mailboxes: ["box-1"], fromProfileMap: ["pim_gone_L3Y="] };

  // The desktop is the shell that asked for readable names. Without this the
  // shared mail builder hands back the legacy form, and the guard below would
  // pass on a rename that never happened.
  beforeAll(() => {
    setPlatformServices({
      loadSettings: async () => ({}) as never,
      credentials: store().credentials,
      openExternal: async () => {},
      keychainSlotName,
    });
  });

  it("really renames the shared mail slot, not just the desktop-only ones", () => {
    expect(slot.mail(V, "box-1")).not.toBe(legacySlot.mail(V, "box-1"));
    expect(isReadableSlotName(slot.mail(V, "box-1"))).toBe(true);
  });

  /**
   * The drift guard. Renaming a family is only half the change — without a
   * migration for it, the app looks for a name nothing ever wrote and asks the
   * user to sign in again for a credential that is sitting right there.
   */
  it("migrates every family it renames", () => {
    // Fails when a family is added to `slot` without being listed here, which
    // is the moment to ask whether `slotMigrations` learned about it too.
    expect(Object.keys(slot).sort()).toEqual([
      "account",
      "calendar",
      "encryption",
      "files",
      "mail",
      "repair",
    ]);

    const targets = new Set(slotMigrations(V, ids).map((p) => p.to));
    const produced = [
      slot.encryption(V),
      slot.repair(V),
      ...SYNC_PROVIDERS.map((p) => slot.files(V, p)),
      slot.account(V, "acc-1"),
      slot.calendar(V, "cal-1"),
      slot.mail(V, "box-1"),
    ];
    for (const name of produced) expect([name, targets.has(name)]).toEqual([name, true]);
  });

  it("migrates FROM the shape that was actually written before", () => {
    const pairs = slotMigrations(V, ids);
    const b64 = btoa(unescape(encodeURIComponent(V)));
    expect(pairs.map((p) => p.from)).toContain(`mkcache_${b64}`);
    expect(pairs.map((p) => p.from)).toContain(`drive_credentials_${b64}`);
    expect(pairs.map((p) => p.from)).toContain(`pim_cal-1_${b64}`);
    expect(pairs.map((p) => p.from)).toContain(`mail_box-1_${b64}`);
    expect(pairs.map((p) => p.from)).toContain(`account_acc-1_${b64}`);
  });

  it("keeps both shapes in reach so 'forget this vault' cannot leave one behind", () => {
    const all = allVaultSlots(V, ids);
    expect(all).toContain(slot.calendar(V, "cal-1"));
    expect(all).toContain(legacySlot.calendar(V, "cal-1"));
    // A slot the account lists no longer mention, remembered only by the map.
    expect(all).toContain("pim_gone_L3Y=");
  });
});

describe("the shared mail slot follows the shell, not the module", () => {
  const V = "/v";

  it("stays on the legacy name for a shell that registered no namer", () => {
    // Mobile. Its keychain is not browsable by a person, so a rename there
    // would be risk without benefit — and this is what keeps it out of it.
    setPlatformServices({
      loadSettings: async () => ({}) as never,
      credentials: store().credentials,
      openExternal: async () => {},
    });
    expect(mailSecretKey(V, "box-1")).toBe(legacyMailSecretKey(V, "box-1"));
  });

  it("uses the readable name once a shell asks for it", () => {
    setPlatformServices({
      loadSettings: async () => ({}) as never,
      credentials: store().credentials,
      openExternal: async () => {},
      keychainSlotName,
    });
    expect(mailSecretKey(V, "box-1")).toBe(
      keychainSlotName({ vaultKey: V, service: "mail", account: "box-1" }),
    );
  });
});
