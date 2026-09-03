import { describe, expect, it } from "vitest";
import { previewLine, regexProblem } from "@plainva/ui";

/**
 * The before/after rows of the vault-wide find & replace (P6): what the user
 * checks before anything is written. Lives beside the other tests of
 * @plainva/ui code — the package has no test runner of its own.
 */
const join = (segs: { text: string; kind: string }[]) => segs.map((s) => (s.kind === "plain" ? s.text : `[${s.kind}:${s.text}]`)).join("");

describe("previewLine", () => {
  it("marks every literal hit and what replaces it", () => {
    const p = previewLine("Die Projektleitung fragt die Projektleitung.", "Projektleitung", "Projektsteuerung");
    expect(join(p.before)).toBe("Die [hit:Projektleitung] fragt die [hit:Projektleitung].");
    expect(join(p.after)).toBe("Die [new:Projektsteuerung] fragt die [new:Projektsteuerung].");
  });

  it("keeps a literal replacement literal, even with a dollar in it", () => {
    const p = previewLine("Preis: 5 EUR", "EUR", "$", {});
    expect(join(p.after)).toBe("Preis: 5 [new:$]");
  });

  it("expands regex groups exactly as the replace will", () => {
    const p = previewLine("2026-09-03 und 2025-12-24", "(\\d{4})-(\\d{2})-(\\d{2})", "$3.$2.$1", { regex: true });
    expect(join(p.before)).toBe("[hit:2026-09-03] und [hit:2025-12-24]");
    expect(join(p.after)).toBe("[new:03.09.2026] und [new:24.12.2025]");
    const named = previewLine("Hallo Welt", "(?<w>Welt)", "<$<w>> $& $$", { regex: true });
    expect(join(named.after)).toBe("Hallo [new:<Welt> Welt $]");
  });

  it("respects whole word and case options", () => {
    expect(join(previewLine("cat catalog Cat", "cat", "dog", { wholeWord: true }).before)).toBe("[hit:cat] catalog [hit:Cat]");
    expect(join(previewLine("cat catalog Cat", "cat", "dog", { wholeWord: true, matchCase: true }).before)).toBe("[hit:cat] catalog Cat");
  });

  it("shows a removed match as nothing in the after row", () => {
    const p = previewLine("a-b-c", "-", "");
    expect(join(p.after)).toBe("abc");
    expect(p.after.every((s) => s.kind === "plain")).toBe(true);
  });

  it("passes an empty query or an invalid regex through unchanged", () => {
    expect(join(previewLine("text", "", "x").before)).toBe("text");
    expect(join(previewLine("text", "(", "x", { regex: true }).after)).toBe("text");
  });
});

describe("regexProblem", () => {
  it("names the engine's reason without the preamble", () => {
    const why = regexProblem("(", { regex: true });
    expect(why).toBeTruthy();
    expect(why).not.toMatch(/^Invalid regular expression/);
  });
  it("is silent outside regex mode and for a usable expression", () => {
    expect(regexProblem("(", {})).toBeNull();
    expect(regexProblem("(a|b)+", { regex: true })).toBeNull();
    expect(regexProblem("", { regex: true })).toBeNull();
  });
});
