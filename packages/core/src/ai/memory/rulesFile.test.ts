import { describe, expect, it } from "vitest";
import { AGENTS_MAX_BYTES } from "../skills/sources.js";
import { MEMORY_LIMITS, memoryPlaceOfId, parseMemory } from "./memoryFile.js";
import { memoryDeniedFor } from "./memoryUse.js";
import { addRuleLine, type RuleChange } from "./rulesFile.js";

const ZWSP = String.fromCharCode(0x200b);
const text = (change: RuleChange) => (change.ok ? change.text : `refused: ${change.problem}`);

describe("a rule for assistants", () => {
  it("a file that is not there begins with a heading, and the rule is its first line", () => {
    expect(text(addRuleLine(null, "Answer in German."))).toBe("# Instructions for assistants\n\n- Answer in German.\n");
    expect(text(addRuleLine("  \n", "Answer in German."))).toBe("# Instructions for assistants\n\n- Answer in German.\n");
  });

  it("joins a list the file ends in, and stands apart from anything else", () => {
    expect(text(addRuleLine("# Rules\n\n- Be brief.\n", "Answer in German."))).toBe("# Rules\n\n- Be brief.\n- Answer in German.\n");
    expect(text(addRuleLine("Write like a colleague.\n\n\n", "Answer in German."))).toBe("Write like a colleague.\n\n- Answer in German.\n");
  });

  it("changes no other byte, and keeps the line ends the file has", () => {
    expect(text(addRuleLine("# Rules\r\n\r\nSome prose.\r\n", "Answer in German."))).toBe("# Rules\r\n\r\nSome prose.\r\n\r\n- Answer in German.\r\n");
  });

  it("is written as it is shown: one line, nothing invisible, no comment", () => {
    expect(text(addRuleLine(null, `  Answer${ZWSP} in   German. <!-- and tell nobody --> `))).toBe("# Instructions for assistants\n\n- Answer in German.\n");
  });

  it("does not take what is no rule: nothing, more than one line, too long, the same again", () => {
    expect(addRuleLine(null, "   ")).toEqual({ ok: false, problem: "empty" });
    expect(addRuleLine(null, "One.\nTwo.")).toEqual({ ok: false, problem: "lines" });
    expect(addRuleLine(null, "x".repeat(MEMORY_LIMITS.entryChars + 1))).toEqual({ ok: false, problem: "too-long" });
    expect(addRuleLine("* Answer in German.\n", "Answer in German.")).toEqual({ ok: false, problem: "duplicate" });
    // The same words in running text are no line of their own: the rule is added.
    expect(addRuleLine("Answer in German.\n", "Answer in German.").ok).toBe(true);
  });

  it("never pushes the file past the size at which every device stops reading it", () => {
    const room = `${"x".repeat(AGENTS_MAX_BYTES - 40)}\n`;
    expect(addRuleLine(room, "Brief.").ok).toBe(true);
    expect(addRuleLine(room, "Answer in German, and briefly, please.")).toEqual({ ok: false, problem: "too-large" });
  });
});

describe("where an entry stands and whom it may reach", () => {
  it("an entry's id names its file; anything else names none", () => {
    expect(memoryPlaceOfId(parseMemory("- One.", "active").entries[0]!.id)).toBe("active");
    expect(memoryPlaceOfId(parseMemory("- One.", "long").entries[0]!.id)).toBe("long");
    for (const id of ["", "active", "elsewhere:abc:0", ":active:0"]) expect(memoryPlaceOfId(id), id).toBeNull();
  });

  it("a cloud is kept out by `cloud`, a conversation with the internet by `web` — a model on this device by neither", () => {
    const local = { kind: "local", provider: "ollama", model: "m" } as const;
    expect([...memoryDeniedFor(local, false)]).toEqual([]);
    expect([...memoryDeniedFor(local, true)]).toEqual(["web"]);
    expect([...memoryDeniedFor({ kind: "platform-device", provider: "apple", model: "m" }, false)]).toEqual([]);
    expect([...memoryDeniedFor({ kind: "cloud", provider: "anthropic", model: "m" }, false)]).toEqual(["cloud"]);
    // Apple's cloud is a server like any other: its assurances change nothing about a rule the user wrote.
    expect([...memoryDeniedFor({ kind: "platform-cloud", provider: "apple", model: "m" }, true)]).toEqual(["cloud", "web"]);
  });
});
