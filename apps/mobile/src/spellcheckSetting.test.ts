import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROFILE_FIELDS } from "@plainva/ui";
import { VAULT_KEYS } from "./services/mobileSettingsScope";

/**
 * The spell-checking switch on the phone (plan Befunde 2026-10-06, E3).
 *
 * The behaviour itself - the switch in the editor settings and an open editor
 * that follows it - is driven in the production suite (e2e-prod/spellcheck).
 * What is pinned here is where the setting lives: with the device.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("spell checking is a device setting", () => {
  it("does not travel with the synced settings profile", () => {
    // Dictionaries, languages and the keyboard belong to the device. A profile
    // field would switch checking on for a phone whose keyboard has no
    // dictionary for the language the desktop writes in.
    for (const field of PROFILE_FIELDS) {
      expect(field.logical.toLowerCase(), field.logical).not.toContain("spell");
      expect(String(field.mobile ?? "").toLowerCase(), field.logical).not.toContain("spell");
    }
  });

  it("is not a per-vault setting either", () => {
    expect(VAULT_KEYS as readonly string[]).not.toContain("spellcheck");
  });

  it("is off by default and reaches the shared rule wherever the settings are applied", () => {
    const source = read("./services/mobileSettings.ts");
    expect(source).toMatch(/\n\s+spellcheck: false,\n/);
    // applySettings() runs on start and after every change of the cache.
    expect(source).toMatch(/function applySettings\(\): void \{[^}]*setSpellcheckOn\(live\(\)\.spellcheck === true\);/);
  });

  it("has its switch on the editor settings screen", () => {
    const source = read("./screens/SettingsAreaScreens.tsx");
    const editor = source.slice(source.indexOf("export function EditorAreaScreen"), source.indexOf("export function ContentAreaScreen"));
    expect(editor).toContain('update({ spellcheck: next })');
    expect(editor).toContain('t("settings.spellcheckDesc")');
  });
});
