import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contentPathRefusal } from "../src/vault/internalPath.ts";

/**
 * The verdicts the MCP server's Rust test reads too (apps/desktop/src-tauri/src/mcp/paths.rs,
 * `content_path_refusal`): one list for both sides, so the native wall and the core cannot
 * disagree about a path an outside client names.
 */
const fixture = JSON.parse(readFileSync(new URL("../src/vault/contentPathRefusal.fixture.json", import.meta.url), "utf8")) as Record<string, unknown>;
const verdicts = ["internal", "device", "stream", "alias", "none"] as const;

describe("the shared verdicts of contentPathRefusal", () => {
  it.each(verdicts)("reaches every verdict the fixture names: %s", (verdict) => {
    const paths = fixture[verdict] as string[];
    expect(paths.length, `the fixture names ${verdict} paths`).toBeGreaterThan(0);
    for (const path of paths) expect(contentPathRefusal(path), JSON.stringify(path)).toBe(verdict === "none" ? null : verdict);
  });

  it("names no other verdict", () => {
    expect(Object.keys(fixture).filter((key) => key !== "about").sort()).toEqual([...verdicts].sort());
  });
});
