import { beforeEach, describe, expect, it, vi } from "vitest";

// The key of the secrets marks has one owner, the app process (round
// fourteen, `src-tauri/src/secure_store.rs`). A window neither reads nor
// writes its slot itself: it only asks, and an error stays an error.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const store = { get: vi.fn(), set: vi.fn(), save: vi.fn(), delete: vi.fn() };
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => store), Store: class {} }));

const { invoke } = await import("@tauri-apps/api/core");
const { credentialManager } = await import("./CredentialManager");

describe("the key of the secrets marks from the app process", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    for (const fn of Object.values(store)) fn.mockReset();
  });

  it("asks the one command with the fresh key and whether marks exist, and takes its answer", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("b".repeat(64));
    await expect(credentialManager.secretsMarkKey("a".repeat(64), true)).resolves.toBe("b".repeat(64));
    expect(vi.mocked(invoke).mock.calls).toEqual([["secrets_mark_key", { fresh: "a".repeat(64), marksOnDevice: true }]]);
    expect([store.get, store.set].map((fn) => fn.mock.calls.length)).toEqual([0, 0]);
  });

  it("a keychain that does not answer is an error: no look into the credentials file, no key made there", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Platform secure storage failure: locked");
    await expect(credentialManager.secretsMarkKey("a".repeat(64), false)).rejects.toBe("Platform secure storage failure: locked");
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["secrets_mark_key"]);
    expect([store.get, store.set, store.save].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0]);
  });
});
