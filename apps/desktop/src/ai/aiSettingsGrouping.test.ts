import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { profilesInOrder } from "@plainva/ui";
import { SETTINGS_SEARCH_INDEX } from "../../../../packages/ui/src/lib/settingsSearchIndex";

/**
 * Settings → AI as the mockup groups it (KI-Oberflächen M2, F71 of release 0.9.0), in both shells: one card "Without a
 * model on this device" with the rows of search by meaning, of what stands next to the open note and of the short
 * summaries, one card "Other programs" with what other makers' programs may do — and the profile that answers listed
 * first. Read from the search index, which is read from the code of both pages.
 */

const ROOT = resolve(__dirname, "../../../..");
const cardOf = (shell: "desktop" | "mobile", label: string) =>
  SETTINGS_SEARCH_INDEX.filter((e) => e.shell === shell && e.area === "ai" && e.kind === "row" && e.label === label).map((e) => e.card);
const cards = (shell: "desktop" | "mobile") => new Set(SETTINGS_SEARCH_INDEX.filter((e) => e.shell === shell && e.area === "ai" && e.kind === "card").map((e) => e.card));

describe("the AI settings in groups (mockup M2)", () => {
  for (const shell of ["desktop", "mobile"] as const) {
    it(`${shell}: search by meaning, the note-side hints and the short summaries share the card “Without a model on this device”`, () => {
      for (const label of ["ai.semantic.title", "ai.hints.show", "ai.gists.show", "ai.transcribe.summary"]) {
        expect(cardOf(shell, label), label).toEqual(["ai.settings.groupNoModel"]);
      }
      // The three old headings are gone as cards.
      for (const old of ["ai.semantic.title", "ai.settings.nextToNote", "ai.gists.title"]) expect(cards(shell).has(old), old).toBe(false);
    });
  }

  it("desktop: AI apps on this computer and external agents share the card “Other programs”", () => {
    expect(cardOf("desktop", "ai.mcp.switch")).toEqual(["ai.settings.groupOtherApps"]);
    expect(cardOf("desktop", "ai.agent.title")).toEqual(["ai.settings.groupOtherApps"]);
    for (const old of ["ai.mcp.title", "ai.agent.title"]) expect(cards("desktop").has(old), old).toBe(false);
  });

  it("phone: the system's assistant stands in “Other programs”", () => {
    expect(cardOf("mobile", "ai.system.find")).toEqual(["ai.settings.groupOtherApps"]);
    expect(cards("mobile").has("ai.system.title")).toBe(false);
  });
});

describe("the profiles, the one that answers first (mockup M2)", () => {
  it("lists the default profile first, then the others in their fixed order", () => {
    expect(profilesInOrder("balanced")).toEqual(["balanced", "fast", "strong", "local"]);
    expect(profilesInOrder("strong")).toEqual(["strong", "fast", "balanced", "local"]);
  });

  it("both settings pages list the profiles in that order", () => {
    for (const file of ["apps/desktop/src/components/settings/AiSettingsPage.tsx", "apps/mobile/src/screens/AiSettingsScreen.tsx"]) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      expect(source, file).toMatch(/profilesInOrder\(settings\.defaultProfile\)\.map\(\(id\) =>/);
      expect(source, file).not.toMatch(/AI_PROFILE_IDS\.map\(\(id\) =>/);
    }
  });
});
