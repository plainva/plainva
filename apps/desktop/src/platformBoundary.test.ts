import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Platform-boundary ratchet (ADR 0011, M0.3): direct settings/keychain
 * plugin access is confined to the two desktop adapters so every other
 * module goes through the platform-neutral interfaces (ISettingsStore /
 * ICredentialStore) and stays reusable by the mobile shell. Tests are
 * exempt — they mock the plugin module by its specifier.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const ALLOWED = new Set(["services/settingsStore.ts", "services/CredentialManager.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("platform boundary (plugin-store)", () => {
  it("only the designated adapters import @tauri-apps/plugin-store", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      if (/\.(test|spec)\.tsx?$/.test(rel)) continue;
      if (readFileSync(file, "utf8").includes("@tauri-apps/plugin-store")) {
        offenders.push(rel);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
