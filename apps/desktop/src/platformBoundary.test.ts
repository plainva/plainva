import { describe, it, expect } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * Platform-boundary ratchet (ADR 0011, M0.3): direct settings/keychain
 * plugin access is confined to the two desktop adapters so every other
 * module goes through the platform-neutral interfaces (ISettingsStore /
 * ICredentialStore) and stays reusable by the mobile shell. Tests are
 * exempt — they mock the plugin module by its specifier.
 */

const ROOT = "apps/desktop/src";

const ALLOWED = new Set(["services/settingsStore.ts", "services/CredentialManager.ts"]);

describe("platform boundary (plugin-store)", () => {
  it("only the designated adapters import @tauri-apps/plugin-store", () => {
    const offenders: string[] = [];
    // The shell's shipped sources (tests are exempt), read through the scan
    // guards' shared snapshot; `rel` is relative to src as ALLOWED has it.
    for (const file of shippedSources([ROOT])) {
      const rel = file.rel.slice(ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;
      if (file.text.includes("@tauri-apps/plugin-store")) {
        offenders.push(rel);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
