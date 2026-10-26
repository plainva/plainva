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

/**
 * The retired button words of every language (the values the retired keys
 * had, and the reconnect words the handbook used for them). The handbook names
 * buttons in bold, literally - one of these in bold names a button that is
 * gone (review of plan "Verbinden", finding 7). A word a current key still
 * says (en "Sign in again", say) is not retired and is skipped.
 */
const RETIRED_BY_LANGUAGE: Record<string, string[]> = {
  "de": ["Neu anmelden", "Auf diesem Gerät anmelden", "Ein Login für alle Dienste", "Trennen", "Getrennt", "Wieder verbinden", "Neu verbinden", "neu verbinden"],
  "en": ["Sign in on this device", "One login for all services", "Disconnect", "Reconnect", "Disconnected"],
  "es": ["Iniciar sesión de nuevo", "Iniciar sesión en este dispositivo", "Un inicio de sesión para todos los servicios", "Desconectar", "Desconectado", "Reconectar", "Reconnect"],
  "fr": ["Se connecter sur cet appareil", "Une connexion pour tous les services", "Déconnecter", "Déconnecté", "Reconnecter"],
  "it": ["Accedi di nuovo", "Accedi su questo dispositivo", "Un accesso per tutti i servizi", "Disconnetti", "Disconnesso"],
  "ja": ["再サインイン", "再度サインイン", "このデバイスでサインイン", "すべてのサービスを 1 回のログインで", "切断", "再ログイン", "切断済み", "再接続"],
  "nl": ["Opnieuw aanmelden", "Op dit apparaat aanmelden", "Een login voor alle diensten", "Verbreken", "Losgekoppeld"],
  "pl": ["Zaloguj ponownie", "Zaloguj się na tym urządzeniu", "Jedno logowanie dla wszystkich usług", "Rozłącz", "Połącz ponownie", "Rozłączony"],
  "pt-BR": ["Entrar neste dispositivo", "Um login para todos os serviços", "Desconectar", "Reconectar", "Desconectado"],
  "zh-CN": ["在此设备上登录", "一次登录，所有服务通用", "断开", "已断开连接", "重新连接"]
};

const DOCS = join(__dirname, "..", "..", "..", "docs", "user");

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

  it("keeps the retired words out of every language, in the app and in the handbook (review finding 7)", () => {
    const found: string[] = [];
    for (const [lang, flat] of locales) {
      const words = RETIRED_BY_LANGUAGE[lang] ?? [];
      // The app: none of the plan's actions says a retired word.
      for (const key of ["deviceSignIn.submit", "cloudAccounts.reconnect", "cloudAccounts.signOutHere", "cloudAccounts.removeAccount", "cloudAccounts.pauseSync"]) {
        const value = flat.get(key) ?? "";
        if (words.includes(value)) found.push(`${lang} locale ${key}: ${value}`);
      }
      // The handbook names buttons in bold, literally: a retired word in bold names a button that is gone.
      const dir = join(DOCS, lang);
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
        readFileSync(join(dir, file), "utf8").split(/\r?\n/).forEach((line, index) => {
          for (const word of words) if (line.includes(`**${word}**`) || line.includes(`**${word}…**`)) found.push(`${lang}/${file}:${index + 1}: ${word}`);
        });
      }
    }
    expect(found).toEqual([]);
  });

  it("has a list for every language", () => {
    expect(Object.keys(RETIRED_BY_LANGUAGE).sort()).toEqual(["de", "en", "es", "fr", "it", "ja", "nl", "pl", "pt-BR", "zh-CN"]);
  });
});
