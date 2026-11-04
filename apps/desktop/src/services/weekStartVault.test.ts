// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getPlatformServices,
  getWeekStartSetting,
  PROFILE_FIELDS,
  profileDefault,
  setPlatformServices,
  setVaultWeekStartScope,
  setWeekStartSetting,
  travelsWithVault,
  WEEK_START_CHANGED_EVENT,
  type WeekStartSetting,
} from "@plainva/ui";

/**
 * The week start travels with the vault (decision E4 of the bug-clearing plan,
 * Sammelplan § 3.46/§ 3.97).
 *
 * It was a setting of each device: the same vault, the same template with
 * `{{weekday:monday}}`, gave one date on a desktop whose week starts on Sunday
 * and another on a phone whose week starts on Monday. The vault keeps it now
 * and the settings profile carries it; a vault that has not said follows the
 * device's choice, as every vault did before.
 */
const device = new Map<string, unknown>();
let original: ReturnType<typeof getPlatformServices> | null = null;

beforeEach(() => {
  device.clear();
  try { original = getPlatformServices(); } catch { original = null; }
  setPlatformServices({
    ...(original ?? {}),
    loadSettings: async () => ({
      get: async <T,>(key: string) => device.get(key) as T,
      set: async (key: string, value: unknown) => { device.set(key, value); },
      delete: async (key: string) => { device.delete(key); },
      save: async () => {},
    }),
  } as unknown as ReturnType<typeof getPlatformServices>);
});
afterEach(() => {
  setVaultWeekStartScope(null);
  if (original) setPlatformServices(original);
});

function vault(initial: unknown = undefined) {
  const own = { value: initial };
  return {
    own,
    scope: {
      read: async () => own.value,
      write: async (value: WeekStartSetting) => { own.value = value; },
    },
  };
}

describe("the week start of a vault", () => {
  it("is the vault's where it has one, else the device's - an old vault keeps what the device said", async () => {
    device.set("calendarWeekStart", "sunday");
    expect(await getWeekStartSetting()).toBe("sunday");
    const old = vault();
    setVaultWeekStartScope(old.scope);
    expect(await getWeekStartSetting()).toBe("sunday");
    const said = vault("monday");
    setVaultWeekStartScope(said.scope);
    expect(await getWeekStartSetting()).toBe("monday");
    // "" is how the profile writes "not said".
    setVaultWeekStartScope(vault("").scope);
    expect(await getWeekStartSetting()).toBe("sunday");
  });

  it("is written to the open vault, and to the device for vaults that have none", async () => {
    const open = vault();
    setVaultWeekStartScope(open.scope);
    let told = 0;
    const listen = () => { told++; };
    window.addEventListener(WEEK_START_CHANGED_EVENT, listen);
    await setWeekStartSetting("saturday");
    window.removeEventListener(WEEK_START_CHANGED_EVENT, listen);
    expect(open.own.value).toBe("saturday");
    expect(device.get("calendarWeekStart")).toBe("saturday");
    expect(told).toBe(1);
    // Another vault that never said follows the last choice.
    setVaultWeekStartScope(vault().scope);
    expect(await getWeekStartSetting()).toBe("saturday");
  });

  it("travels with the vault in both shells, and is absent - not Monday - where a vault never said", () => {
    const field = PROFILE_FIELDS.find((f) => f.logical === "weekStart");
    expect(field).toMatchObject({ scope: "vault", kind: "text", desktop: "store", mobile: "weekStart" });
    expect(travelsWithVault("weekStart", "desktop")).toBe(true);
    expect(travelsWithVault("weekStart", "mobile")).toBe(true);
    // An absent field must not overwrite the device's choice with Monday.
    expect(profileDefault("weekStart")).toBe("");
  });

  it("is named by every window of the desktop for the vault it shows, and by the phone for its open vault", () => {
    for (const file of ["../App.tsx", "../FullApp.tsx", "../AuxApp.tsx"]) {
      expect(readFileSync(resolve(__dirname, file), "utf8"), file).toContain("useVaultWeekStart(");
    }
    const phone = readFileSync(resolve(__dirname, "../../../mobile/src/services/mobileSettings.ts"), "utf8");
    expect(phone).toMatch(/setVaultWeekStartScope\(\{\s*read: async \(\) => live\(\)\.weekStart,/);
  });
});
