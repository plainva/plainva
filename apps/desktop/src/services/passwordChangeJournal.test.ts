import { describe, expect, it, vi } from "vitest";
import { createPasswordChangeJournal, type PasswordChangeJournal, type ProtectedSecretStore } from "@plainva/ui";
import { protectedSecrets } from "./protectedSecrets";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const value: PasswordChangeJournal = { version: 1, id: "operation", owner: "vault/account", binding: "vault/account", targets: [
  { service: "files", previous: "old", next: "new", confirmed: false },
] };

function fixture() {
  let raw: string | null = null;
  const store: ProtectedSecretStore = {
    read: async () => raw,
    compareAndSet: async (_key, expected, next) => {
      if (raw !== expected) return false;
      raw = next; return true;
    },
  };
  return { store, setRaw: (value: string | null) => { raw = value; }, getRaw: () => raw };
}

describe("protected password journal", () => {
  it("serializes only into the protected store and deletes only its own confirmed value", async () => {
    const f = fixture(), journal = createPasswordChangeJournal(f.store, "journal");
    await journal.write(value, null);
    expect(await journal.read()).toEqual(value);
    await expect(journal.clear({ ...value, id: "other" })).rejects.toMatchObject({ phase: "changed" });
    expect(f.getRaw()).not.toBeNull();
    await journal.clear(value); expect(f.getRaw()).toBeNull();
  });

  it("does not overwrite a journal inserted by another window after its read", async () => {
    const f = fixture();
    f.store.compareAndSet = async () => { f.setRaw(JSON.stringify({ ...value, id: "other-window" })); return false; };
    await expect(createPasswordChangeJournal(f.store, "journal").write(value, null)).rejects.toMatchObject({ phase: "changed" });
    expect(JSON.parse(f.getRaw()!).id).toBe("other-window");
  });

  it.each(["unreadable JSON", "null"])("does not replace corrupt protected content: %s", async (raw) => {
    const f = fixture(); f.setRaw(raw);
    const journal = createPasswordChangeJournal(f.store, "journal");
    await expect(journal.read()).rejects.toThrow();
    await expect(journal.write(value, null)).rejects.toThrow();
    expect(f.getRaw()).toBe(raw);
  });

  it("propagates native unavailability without a fallback or a write", async () => {
    native.invoke.mockReset().mockRejectedValue(Error("keychain locked"));
    await expect(protectedSecrets.read("journal")).rejects.toThrow("keychain locked");
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("keychain_get", { key: "journal" });
  });

  it("sends an explicit predecessor and validates the native conditional response", async () => {
    native.invoke.mockReset().mockResolvedValue(false);
    await expect(protectedSecrets.compareAndSet("journal", null, "value")).resolves.toBe(false);
    expect(native.invoke).toHaveBeenCalledWith("keychain_compare_and_set", { key: "journal", expected: null, value: "value" });
    native.invoke.mockResolvedValue("true");
    await expect(protectedSecrets.compareAndSet("journal", null, "value")).rejects.toThrow("Invalid");
    native.invoke.mockResolvedValue(undefined);
    await expect(protectedSecrets.read("journal")).rejects.toThrow("Invalid");
  });
});
