// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, type AiEgress } from "@plainva/core";
import { AiSession, getDiagnostics, clearDiagnosticsForTests, toast, toastStore } from "@plainva/ui";

/**
 * Removing an AI provider whose key cannot be deleted (stability plan R4): the
 * key would stay on the device with no row left to delete it from, so the
 * provider stays listed and the person is told why. Pinned on purpose: the
 * old behaviour took the provider off the list and kept the key without a word.
 */

afterEach(() => {
  clearDiagnosticsForTests();
  toast.clearAll();
});

function session(deleteKey: () => Promise<void>) {
  let settings: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m" } } };
  const egress: AiEgress = {
    async send() {},
    async cancel() {},
    async setKey() {},
    async hasKey() { return true; },
    deleteKey,
    async addEndpoint() { return true; },
    async removeEndpoint() {},
  };
  const s = new AiSession({
    egress,
    async loadSettings() { return settings; },
    async saveSettings(next) { settings = next; },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-11-12",
    now: () => new Date("2026-11-12T10:00:00Z"),
    newId: () => "c1",
  });
  return { s, settings: () => settings as { providers: string[] } };
}

describe("removing a provider", () => {
  it("keeps the provider listed and says so when its key cannot be deleted", async () => {
    const { s, settings } = session(async () => { throw new Error("keychain locked"); });
    await s.load();
    await s.removeProvider("anthropic");
    expect(settings().providers).toEqual(["anthropic"]);
    expect(toastStore.get().map((t) => t.kind)).toEqual(["error"]);
    expect(getDiagnostics().map((e) => e.source)).toContain("ai:provider-key");
  });

  it("takes it off the list once its key is gone", async () => {
    const { s, settings } = session(async () => {});
    await s.load();
    await s.removeProvider("anthropic");
    expect(settings().providers).toEqual([]);
    expect(toastStore.get()).toEqual([]);
  });
});
