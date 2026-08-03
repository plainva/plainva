import { describe, expect, it } from "vitest";
import { appendOperator, COMMAND_PREFIX, OPERATOR_CHIPS, parseQuery } from "./searchMode";

describe("one field, three jobs", () => {
  it("reads an empty field as an offer, not a search", () => {
    expect(parseQuery("").mode).toBe("idle");
    expect(parseQuery("   ").mode).toBe("idle");
  });

  it("switches to commands on the palette prefix", () => {
    expect(COMMAND_PREFIX).toBe(">");
    expect(parseQuery(">").mode).toBe("commands");
    expect(parseQuery("> graph")).toEqual({ mode: "commands", term: "graph" });
    // Leading whitespace must not hide the prefix — a keyboard adds one easily.
    expect(parseQuery("  >new").mode).toBe("commands");
  });

  it("treats a > inside the query as text", () => {
    // Only a LEADING prefix means commands; "a > b" is something someone wrote.
    expect(parseQuery("a > b")).toEqual({ mode: "find", term: "a > b" });
  });

  it("appends an operator with exactly one space", () => {
    expect(appendOperator("", "tag:")).toBe("tag:");
    expect(appendOperator("notes", "tag:")).toBe("notes tag:");
    expect(appendOperator("notes ", "tag:")).toBe("notes tag:");
  });

  it("offers the operators the search parser actually supports", () => {
    expect(OPERATOR_CHIPS.map((o) => o.insert)).toEqual(["tag:", "path:", '""', "-"]);
  });
});
