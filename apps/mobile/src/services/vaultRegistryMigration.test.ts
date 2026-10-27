import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => undefined } }));

import { migrateLegacyPause, type RegistryState } from "./vaultRegistry";

/**
 * Second review of plan "Verbinden", B4a: older versions wrote the person's
 * "Trennen" as `paused`, and a password change later cleared that flag as if
 * it were the app's own - the vault synced again although the person had
 * stopped it. It is moved once to `pausedHere`, which only the person ends.
 */
describe("the pause older versions wrote", () => {
  it("becomes the person's own pause", () => {
    const registry: RegistryState = {
      activeId: "a",
      vaults: [{ id: "a", name: "", provider: "webdav", paused: true }, { id: "b", name: "B", provider: "drive", paused: false }, { id: "c", name: "C" }],
    };
    expect(migrateLegacyPause(registry).vaults).toEqual([
      { id: "a", name: "", provider: "webdav", pausedHere: true },
      { id: "b", name: "B", provider: "drive" },
      { id: "c", name: "C" },
    ]);
  });

  it("leaves a registry without it as it is", () => {
    const registry: RegistryState = { activeId: "a", vaults: [{ id: "a", name: "", pausedHere: true }] };
    expect(migrateLegacyPause(registry)).toBe(registry);
  });
});
