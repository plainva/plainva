// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every window follows a saved daily-note naming (F8 of release 0.9.0). The
 * window that saved it and the phone did; another full window on the vault
 * reloaded with the naming it had opened with, and an auxiliary window began
 * with none at all.
 */
type Handler = (payload: { domain: string }, from: string, vaultPath: string | null) => void;
const bus = vi.hoisted(() => ({ handlers: [] as Array<(payload: { domain: string }, from: string, vaultPath: string | null) => void>, sent: [] as unknown[][] }));
vi.mock("./services/windowBus", () => ({
  getWindowBus: async () => ({
    broadcast: async (...args: unknown[]) => void bus.sent.push(args),
    onBroadcast: async (_channel: string, handler: Handler) => void bus.handlers.push(handler),
  }),
}));
import { announceVaultFeaturesSaved, FEATURES_SAVED_EVENT, installVaultFeaturesRelay } from "./services/vaultFeaturesRelay";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("a vault's saved features reach every window", () => {
  it("a save is told to the others, for its vault", async () => {
    announceVaultFeaturesSaved("/v/Notes");
    await vi.waitFor(() => expect(bus.sent).toEqual([["settings-changed", { domain: "vault-features" }, "/v/Notes"]]));
  });

  it("a save in another window reads as one here", async () => {
    await installVaultFeaturesRelay();
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(FEATURES_SAVED_EVENT, listener);
    bus.handlers[0]({ domain: "mail-accounts" }, "w2", "/v/Notes");
    bus.handlers[0]({ domain: "vault-features" }, "w2", "/v/Notes");
    window.removeEventListener(FEATURES_SAVED_EVENT, listener);
    expect(seen).toEqual([{ vaultPath: "/v/Notes" }]);
  });

  it("every window installs it, the settings and a profile from another device announce it", () => {
    const main = source("apps/desktop/src/main.tsx");
    expect(main.match(/installVaultFeaturesRelayQuietly\(\);/g)).toHaveLength(2);
    const settings = source("apps/desktop/src/components/SettingsModal.tsx");
    expect(settings.match(/announceVaultFeaturesSaved\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(source("apps/desktop/src/services/settingsProfile.ts")).toMatch(/announceVaultFeaturesSaved\(vaultPath\);/);
  });

  it("an auxiliary window's vault knows the naming from its first query", () => {
    expect(source("apps/desktop/src/services/clientVault.ts")).toMatch(
      /const queryService = new VaultQueryService\(dbAdapter\);[\s\S]{0,400}queryService\.setDayOfPath\(readDailyDayOfPath\(vaultPath\)\);/,
    );
  });
});
