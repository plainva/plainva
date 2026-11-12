import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { safeRelPath } from "@plainva/ui";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { mcpNameAccepted } = await import("../services/ai/mcpBridge");

/**
 * The one spelling of a path between the MCP server's wall and the file system (R19 of the stability plan, after
 * two independent reviews). The wall (apps/desktop/src-tauri/src/mcp/paths.rs, `safe_rel_path`) checks a spelling
 * and forwards exactly that string; the Rust test reads the same list, which packages/core/test/mcpPathSpellingFixture.ts
 * writes. Here: the web view keeps every checked spelling, reads every raw argument the wall takes as the same place,
 * and `mcpNameAccepted` is the wall's rule for a name taken as it stands (`exact_rel_path`).
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
const taken = fixture.cases.filter((c): c is Case & { checked: string } => c.checked !== null);

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

  it("keeps every checked spelling exactly as it is", () => {
    expect(taken.length).toBeGreaterThan(50);
    for (const c of taken) expect(safeRelPath(c.checked), `${c.why}: ${JSON.stringify(c.checked)}`).toBe(c.checked);
  });

  it("reads every raw argument the wall takes as the place the wall checked", () => {
    for (const c of taken) {
      const used = safeRelPath(c.input);
      expect(used, `${c.why}: ${JSON.stringify(c.input)}`).not.toBeNull();
      expect(used!.normalize("NFC"), c.why).toBe(c.checked);
    }
  });

  it("takes a name as it stands exactly where the wall does", () => {
    for (const c of fixture.cases) expect(mcpNameAccepted(c.input), `${c.why}: ${JSON.stringify(c.input)}`).toBe(c.checked === c.input);
    for (const c of taken) expect(mcpNameAccepted(c.checked), `${c.why}: ${JSON.stringify(c.checked)}`).toBe(true);
    expect(fixture.cases.filter((c) => c.checked === c.input).length).toBeGreaterThan(5);
  });
});
