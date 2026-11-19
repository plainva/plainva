import { describe, expect, it } from "vitest";
import { propertiesAsWritten } from "../src/frontmatter-surgical.ts";
import { redactDeniedLinks } from "../src/ai/egressGate.ts";

/**
 * A note's properties with their wiki links as they are written (review of R19, wave 2): YAML reads a link without
 * quotes as a list in a list, a list of two names or a map — no reading of the parsed value can tell it from a list
 * again, so the value is read from the text it is written with.
 */
const NOTE =
  "---\n" +
  "comma: [[Meier, Kowalski]]\n" +
  "labelled: [[Salary Kowalski|Pay, Kowalski]]\n" +
  "colon: [[Plan: Kowalski]]\n" +
  "spread: [[Meier,\n   Kowalski]]\n" +
  "items:\n  - [[Meier, Kowalski]]\n  - plain\n" +
  "inside:\n  rel: [[X, Y]]\n" +
  "several: [[[A]], [[B, C]]]\n" +
  'quoted: "[[Q]]"\n' +
  "block: |\n  [[Z, W]]\n" +
  "lists: [[a], [b]]\n" +
  "tags: [a, b]\n" +
  "number: 4\n" +
  "---\nbody\n";

describe("properties as they are written", () => {
  it("reads every wiki link without quotes as the text it is, and every other value as the index holds it", () => {
    expect(Object.fromEntries(propertiesAsWritten(NOTE)!)).toEqual({
      comma: "[[Meier, Kowalski]]",
      labelled: "[[Salary Kowalski|Pay, Kowalski]]",
      colon: "[[Plan: Kowalski]]",
      spread: "[[Meier, Kowalski]]",
      items: ["[[Meier, Kowalski]]", "plain"],
      inside: { rel: "[[X, Y]]" },
      several: ["[[A]]", "[[B, C]]"],
      quoted: "[[Q]]",
      block: "[[Z, W]]\n",
      lists: [["a"], ["b"]],
      tags: ["a", "b"],
      number: 4,
    });
    expect(propertiesAsWritten("# no block\n")).toBeNull();
    expect(propertiesAsWritten("---\na: [unclosed\n---\n")).toBeNull();
  });

  it("withholds a link spread over lines in the properties block, as YAML reads it, and only there", () => {
    const denied = (target: string) => target === "Meier, Kowalski";
    expect(redactDeniedLinks("---\nup: [[Meier,\n   Kowalski]]\n---\n# x\n", denied).text).toBe("---\nup: ⟦withheld note⟧\n---\n# x\n");
    // In the text of a note no reader takes such a thing for a link.
    expect(redactDeniedLinks("# x\n\n[[Meier,\n   Kowalski]]\n", denied).text).toBe("# x\n\n[[Meier,\n   Kowalski]]\n");
  });
});
