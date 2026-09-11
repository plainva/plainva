import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({ Preferences: {
  get: async ({ key }: { key: string }) => ({ value: stored.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { stored.set(key, value); },
} }));
vi.mock("@plainva/ui", () => ({ getPlatformServices: () => ({ credentials: { removeSecret: async () => {} } }) }));

beforeEach(() => { stored.clear(); vi.resetModules(); });
describe("vault creation intent survives no reopen path", () => {
  it("allows first registration once, not a later app start", async () => {
    const first = await import("./vaultRegistry");
    await first.loadRegistry();
    expect(first.consumeNewLocalVault("local")).toBe(true);
    expect(first.consumeNewLocalVault("local")).toBe(false);
    vi.resetModules();
    const reopened = await import("./vaultRegistry");
    await reopened.loadRegistry();
    expect(reopened.consumeNewLocalVault("local")).toBe(false);
  });
  it("does not turn legacy or empty registered vaults into newly created ones", async () => {
    stored.set("vault_registry", JSON.stringify({ activeId: "existing", vaults: [{ id: "existing", name: "Empty" }, { id: "local", name: "" }] }));
    const registry = await import("./vaultRegistry");
    await registry.loadRegistry();
    expect(registry.consumeNewLocalVault("existing")).toBe(false);
    await registry.setActiveVault("local");
    await registry.setActiveVault("existing");
    expect(registry.consumeNewLocalVault("existing")).toBe(false);
    expect(registry.consumeNewLocalVault("local")).toBe(false);
  });
  it("rejects duplicate ids and keeps cloud/open and external paths out of local creation", async () => {
    const registry = await import("./vaultRegistry");
    await registry.addVault({ id: "new", name: "New" });
    expect(registry.consumeNewLocalVault("new")).toBe(true);
    await expect(registry.addVault({ id: "new", name: "Again" })).rejects.toThrow();
    await registry.addVault({ id: "remote", name: "Remote", provider: "webdav" });
    expect(registry.consumeNewLocalVault("remote")).toBe(false);
    await registry.addVault({ id: "external", name: "Folder", external: { handle: "x", label: "x", platform: "ios" } });
    expect(registry.consumeNewLocalVault("external")).toBe(false);
  });
});
