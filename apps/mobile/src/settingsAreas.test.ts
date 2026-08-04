import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_AREAS, settingsAreas } from "@plainva/ui";

/**
 * Settings-area congruence ratchet (S39).
 *
 * The phone used to keep its own whitelist of area ids beside the shared
 * catalog. Two lists for one question drift, and this pair did: four areas
 * (start & behaviour, updates, bars & areas, maintenance) were missing without
 * anyone deciding they should be — the same failure mode as the per-shell
 * settings lists that package A replaced with PROFILE_FIELDS.
 *
 * So the rule is: every catalog area either HAS a mobile screen or says in the
 * catalog why it has none. A new area is then visible on the phone by default,
 * and hiding one costs a written sentence.
 */
const here = dirname(fileURLToPath(import.meta.url));
const routes = readFileSync(join(here, "routes.tsx"), "utf8");

describe("mobile settings areas follow the shared catalog", () => {
  it("routes every area that is not explicitly omitted", () => {
    const missing = SETTINGS_AREAS.filter((area) => {
      if (area.mobileOmitted) return false;
      // Routed either through the settingsArea dispatcher or its own nav kind.
      return !new RegExp(`case "${area.id}":|id === "${area.id}"`).test(routes);
    }).map((a) => a.id);
    expect(
      missing,
      `these settings areas have no mobile screen and no stated reason: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("states a reason for every omitted area instead of dropping it silently", () => {
    for (const area of SETTINGS_AREAS) {
      if (!area.mobileOmitted) continue;
      expect(area.mobileOmitted.trim().length, `${area.id} needs a reason`).toBeGreaterThan(10);
    }
  });

  it("hands the mobile shell the catalog minus the omissions", () => {
    const app = settingsAreas("app", { mobile: true }).map((a) => a.id);
    expect(app).not.toContain("updates");
    expect(app).toContain("behavior");
    // Vault areas are complete on the phone since S39.
    expect(settingsAreas("vault", { mobile: true }).map((a) => a.id)).toEqual(
      settingsAreas("vault").map((a) => a.id)
    );
  });

  it("keeps the master list derived, not hand-written", () => {
    const screen = readFileSync(join(here, "SettingsScreen.tsx"), "utf8");
    // A literal id array here is how the two lists drifted apart before.
    expect(screen).not.toContain("MOBILE_AREAS");
    expect(screen).toContain('settingsAreas("app", { mobile: true })');
    expect(screen).toContain('settingsAreas("vault", { mobile: true })');
  });

  it("never falls back to the About screen for an unknown area id", () => {
    // The dispatcher used to `default: return <AboutAreaScreen …>`, so a typo in
    // an id rendered About and looked like a working screen.
    expect(routes).not.toMatch(/default:\s*return <AboutAreaScreen/);
  });
});
