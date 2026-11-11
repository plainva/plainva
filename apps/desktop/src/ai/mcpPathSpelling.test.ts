import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { safeRelPath } from "@plainva/ui";

/**
 * The one spelling of a path between the MCP server's wall and the file system (R19 of the stability plan, after
 * the independent review). The wall (apps/desktop/src-tauri/src/mcp/paths.rs, `safe_rel_path`) checks a spelling
 * and forwards exactly that string; the Rust test reads the same list. Here: the web view leaves every such string
 * as it is, means the same place by a raw argument as the wall does, and the trim set the wall copies is this
 * engine's.
 */
interface Case {
  input: string;
  checked: string | null;
  why: string;
}
const fixture = JSON.parse(readFileSync(new URL("../../../../packages/core/src/vault/mcpPathSpelling.fixture.json", import.meta.url), "utf8")) as {
  trimSet: number[];
  cases: Case[];
};

describe("the spelling the MCP server checks is the one the web view uses", () => {
  it("copies this engine's trim set", () => {
    const engine: number[] = [];
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if ((c + "a").trim() === "a" && ("a" + c).trim() === "a") engine.push(cp);
    }
    expect(fixture.trimSet).toEqual(engine);
  });

  it("leaves every checked spelling as it is — or refuses it, never another one", () => {
    const checked = fixture.cases.filter((c): c is Case & { checked: string } => c.checked !== null);
    expect(checked.length).toBeGreaterThan(50);
    for (const c of checked) {
      const used = safeRelPath(c.checked);
      expect(used === null || used === c.checked, `${c.why}: ${JSON.stringify(c.checked)} -> ${JSON.stringify(used)}`).toBe(true);
    }
  });

  it("reads a raw argument as the same place the wall checked", () => {
    for (const c of fixture.cases) {
      const used = safeRelPath(c.input);
      if (used === null || c.checked === null) continue;
      expect(used.normalize("NFC"), c.why).toBe(c.checked);
    }
    expect(fixture.cases.some((c) => c.checked === null)).toBe(true);
  });
});
