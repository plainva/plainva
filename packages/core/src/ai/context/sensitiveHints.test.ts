import { describe, expect, it } from "vitest";
import { goingKinds, redactSensitive, sensitiveFindings, sensitiveKinds } from "./sensitiveHints.js";

const kinds = (text: string) => sensitiveKinds(sensitiveFindings(text));

/** Plan KI-Harness P2b-6: local patterns as a hint, each checked before it counts. */
describe("sensitivity hints", () => {
  it("finds account and card numbers only when their check digits hold", () => {
    expect(kinds("Pay to DE89 3704 0044 0532 0130 00 by Friday.")).toEqual(["account"]);
    expect(kinds("Pay to DE89370400440532013000 by Friday.")).toEqual(["account"]);
    expect(kinds("Pay to DE89 3704 0044 0532 0130 01 by Friday.")).toEqual([]);
    expect(kinds("Card 4111 1111 1111 1111, expires 12/28.")).toEqual(["card"]);
    expect(kinds("Card 4111 1111 1111 1112.")).toEqual([]);
  });

  it("finds passwords, PINs, keys and ID numbers behind their labels", () => {
    expect(kinds("Wi-Fi password: Sommer2026!")).toEqual(["credential"]);
    expect(kinds("Router PIN: 4711")).toEqual(["credential"]);
    expect(kinds(`key ${"sk"}-proj-${"a1B2".repeat(8)}`)).toEqual(["credential"]);
    expect(kinds("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----")).toEqual(["credential"]);
    expect(kinds("SSN 123-45-6789")).toEqual(["id"]);
    expect(kinds("Reisepass Nr. C01X00T47, gültig bis 2031")).toEqual(["id"]);
    expect(kinds("Steuer-ID: 12 345 678 901")).toEqual(["id"]);
    expect(kinds("パスポート番号: TK1234567")).toEqual(["id"]);
  });

  it("names a health matter where two of its words meet, in the app's languages", () => {
    for (const text of [
      "The diagnosis came on Monday; the doctor calls back.",
      "Neuer Befund vom Arzt.",
      "Nouvelle ordonnance du médecin.",
      "Los síntomas siguen, dice el médico.",
      "Diagnoza od lekarza w piątek.",
      "医師の診断を受けた。",
      "医生的诊断",
    ]) {
      expect(kinds(text), text).toEqual(["health"]);
    }
  });

  it("leaves everyday text alone: dates, amounts, phones, recipes, labels without values, one health word", () => {
    for (const text of [
      "Deadline 2026-10-01, budget 212.000 EUR, call +49 170 1234567.",
      "Call +49 1512 3456 7890 after lunch.",
      "Order 1700000000000 shipped.",
      "Rezept für Brot: 500 g Mehl.",
      "The password field stays empty in the form.",
      "We passed the ID check at the door.",
      "Passport renewal next week, photos at the shop.",
      "Pick up the passport 2026-10-15 at the town hall.",
      "Diagnose the build failure first; the Great Depression chapter can wait.",
      "Über & Diagnose: der Diagnose-Export ist englisch.",
      "Nie wieder Freitagsdeploys.",
    ]) {
      expect(kinds(text), text).toEqual([]);
    }
  });

  it("redacts the numbers and secrets, never the health words", () => {
    const text = "IBAN DE89 3704 0044 0532 0130 00, password: geheim42, Befund vom Arzt liegt vor.";
    const out = redactSensitive(text, sensitiveFindings(text));
    expect(out.redacted).toBe(2);
    expect(out.text).toBe("IBAN ⟦withheld account⟧, ⟦withheld credential⟧ Befund vom Arzt liegt vor.");
    expect(goingKinds(["credential", "account", "health"], true)).toEqual(["health"]);
    expect(goingKinds(["account"], false)).toEqual(["account"]);
  });
});
