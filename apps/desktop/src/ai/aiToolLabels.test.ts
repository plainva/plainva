import { describe, expect, it } from "vitest";
import { DISPATCH_TOOL, FIND_TOOL, isScriptToolName, scriptToolName, toolByName } from "@plainva/core";
import { APP_LANGUAGES, scriptToolLabel, SKILL_TOOL_NAMES } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * A tool shows by its own words in three places: the step line of a run
 * ("Drafting a note"), the send overview, and a skill's review. Where it has
 * none, the step line falls back to "Using a tool" — which is how two tools
 * went out nameless before this guard (AI harness P5-6). The words are looked
 * up by the tool's name at run time, so no key scan sees a missing one.
 */

/** Everything a conversation can carry: its own tools, the mail tools, the writing tools, and the three that reach further. */
const CARRIED = [...SKILL_TOOL_NAMES, FIND_TOOL, DISPATCH_TOOL, "use_skill"];

describe("the words of a tool", () => {
  it("are there for every tool a conversation can carry, in every language of the app", () => {
    const missing: string[] = [];
    for (const { code } of APP_LANGUAGES) {
      for (const name of CARRIED) {
        // Asked of the language's own catalog: a fallback to another language would hide the gap.
        const words: unknown = i18n.getResource(code, "translation", `ai.tool.${name}`);
        if (typeof words !== "string" || !words.trim()) missing.push(`${code}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("belong to tools that exist — a renamed tool does not leave its old words behind unnoticed", () => {
    expect(CARRIED.filter((name) => !toolByName(name))).toEqual([]);
    const known = Object.keys(i18n.getResource("en", "translation", "ai.tool") as Record<string, string>);
    // "unknown" is the fallback itself; "script" are the words of any script's tool (plan P5.5), which is named by the script.
    expect(known.filter((name) => name !== "unknown" && name !== "script" && !toolByName(name))).toEqual([]);
  });

  it("name a script's tool by the script — in every language, and never by the name a model calls it by", () => {
    const tool = scriptToolName("tag-count");
    expect(isScriptToolName(tool)).toBe(true);
    for (const { code } of APP_LANGUAGES) {
      const t = i18n.getFixedT(code);
      const words = scriptToolLabel(t, tool);
      expect(words, code).toContain("tag-count");
      expect(words, code).not.toContain("script_");
    }
    // One of the app's own tools is not a script, whatever its name begins with.
    expect(scriptToolLabel(i18n.getFixedT("en"), "search_vault")).toBeNull();
  });
});
