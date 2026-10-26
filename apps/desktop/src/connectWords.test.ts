import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The words of connecting (plan "Verbinden", V2/V5): "Anmelden" / "Erneut
 * anmelden", "Auf diesem Gerät abmelden", "Konto entfernen", a service "an" /
 * "aus", "Abgleich pausieren". Before, signing in again had five names and
 * switching off four, and a page used whichever its author met first.
 *
 * This guard keeps the old ones out of all ten languages - the way the guard
 * for the Dutch terms does: the keys are gone, and no German string says them
 * under another key.
 */

const LOCALES = join(__dirname, "..", "..", "..", "packages", "ui", "src", "locales");

const RETIRED_KEYS = [
  "pim.signInAgain",
  "pim.blockReauth",
  "deviceSignIn.action",
  "deviceSignIn.signIn",
  "cloudAccounts.unifyLogin",
  "cloudAccounts.unifyHintMobile",
  "cloudAccounts.unifyAvailable",
  "cloudAccounts.unifyPending",
  "cloudAccounts.resetSharedLogin",
  "cloudAccounts.sharedLoginGroup",
  "mobile.syncDisconnect",
  "mobile.reconnectAction",
];

/** The old German words, as a whole value or inside one. */
const RETIRED_WORDS = ["Neu anmelden", "Ein Login für alle Dienste", "Geteilte Anmeldung zurücksetzen", "Auf diesem Gerät anmelden"];
/** Old words that may only go as a whole value (they are ordinary words inside a sentence). */
const RETIRED_VALUES = ["Trennen", "Getrennt", "Wieder verbinden"];

function flatten(value: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (typeof value === "string") out.set(prefix, value);
  return out;
}

const locales = readdirSync(LOCALES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [file.replace(/\.json$/, ""), flatten(JSON.parse(readFileSync(join(LOCALES, file), "utf8")))] as const);

describe("the words of connecting", () => {
  it("checks all ten languages", () => {
    expect(locales.map(([lang]) => lang).sort()).toEqual(["de", "en", "es", "fr", "it", "ja", "nl", "pl", "pt-BR", "zh-CN"]);
  });

  it("has retired the old keys in every language", () => {
    const left: string[] = [];
    for (const [lang, flat] of locales) for (const key of RETIRED_KEYS) if (flat.has(key)) left.push(`${lang}: ${key}`);
    expect(left).toEqual([]);
  });

  it("does not say the old German words under another key", () => {
    const de = locales.find(([lang]) => lang === "de")![1];
    const found: string[] = [];
    for (const [key, value] of de) {
      for (const word of RETIRED_WORDS) if (value.includes(word)) found.push(`${key}: ${word}`);
      for (const word of RETIRED_VALUES) if (value === word) found.push(`${key}: ${word}`);
    }
    expect(found).toEqual([]);
  });

  it("names the plan's words where the account page reads them", () => {
    const de = locales.find(([lang]) => lang === "de")![1];
    expect(de.get("deviceSignIn.submit")).toBe("Anmelden");
    expect(de.get("cloudAccounts.reconnect")).toBe("Erneut anmelden");
    expect(de.get("cloudAccounts.signOutHere")).toBe("Auf diesem Gerät abmelden");
    expect(de.get("cloudAccounts.removeAccount")).toBe("Konto entfernen");
    expect(de.get("cloudAccounts.pauseSync")).toBe("Abgleich pausieren");
    expect(de.get("deviceSignIn.needed")).toBe("Anmeldung nötig");
    expect(de.get("cloudAccounts.stateExpired")).toBe("Abgelaufen");
  });
});
