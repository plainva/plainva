import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildMcpPathSpellingFixture, engineTrimSet } from "./mcpPathSpellingFixture.ts";

const file = new URL("../src/vault/mcpPathSpelling.fixture.json", import.meta.url);

describe("the shared list of path spellings of the MCP server", () => {
  it("is its generator's output", () => {
    const text = `${JSON.stringify(buildMcpPathSpellingFixture(), null, 2)}\n`;
    if (process.env.PLAINVA_WRITE_MCP_SPELLING === "1") writeFileSync(file, text, "utf8");
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  it("carries the trim set of this engine, and every case refuses or names a spelling the trim leaves alone", () => {
    const fixture = JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof buildMcpPathSpellingFixture>;
    expect(fixture.trimSet).toEqual(engineTrimSet());
    expect(fixture.trimSet).toHaveLength(25);
    expect(fixture.cases.filter((c) => c.checked === null).length).toBeGreaterThan(10);
    for (const c of fixture.cases) if (c.checked !== null) expect(c.checked.trim(), c.why).toBe(c.checked);
  });
});
