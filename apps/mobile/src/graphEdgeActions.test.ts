import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Parity `graph-edge-actions`: the desktop's edge menu takes a text link or one
 * relation entry out of its note; the phone's edge sheet only opened the two
 * notes. The sheet now offers the same two removals — each behind a
 * confirmation, each saying what it did or why it failed.
 */
const SCREEN = readFileSync(join(__dirname, "screens", "GraphScreen.tsx"), "utf8");

function body(start: string, span = 1500): string {
  const at = SCREEN.indexOf(start);
  expect(at, `${start} is missing`).toBeGreaterThanOrEqual(0);
  return SCREEN.slice(at, at + span);
}

describe("the graph edge sheet removes links as the desktop's edge menu does", () => {
  it("asks first, then removes the text links through the shared helper", () => {
    const fn = body("const removeEdgeTextLinks = async (");
    expect(fn.indexOf("mConfirm(")).toBeGreaterThan(-1);
    expect(fn.indexOf("mConfirm(")).toBeLessThan(fn.indexOf("removeLinksTo("));
    expect(fn).toMatch(/graph\.edgeNothingRemoved/);
    expect(fn).toMatch(/graph\.cleanupActionFailed/);
    expect(fn).toMatch(/vault\.reindexPaths\(\[source\]\)/);
    expect(fn).toMatch(/syncSoon\(\)/);
    expect(fn.indexOf("vault.reindexPaths([source])")).toBeLessThan(fn.indexOf("setReload("));
    expect(fn).toMatch(/setReload\(/);
  });

  it("asks first, then removes a relation entry through the shared helper, and says why a write failed", () => {
    const fn = body("const removeEdgeRelation = async (");
    expect(fn.indexOf("mConfirm(")).toBeGreaterThan(-1);
    expect(fn.indexOf("mConfirm(")).toBeLessThan(fn.indexOf("removeRelationLink("));
    expect(fn).toMatch(/vault\.reindexPaths\(\[source\]\)/);
    expect(fn).toMatch(/syncSoon\(\)/);
    expect(fn.indexOf("vault.reindexPaths([source])")).toBeLessThan(fn.indexOf("setReload("));
    expect(fn).toMatch(/toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\)/);
    expect(fn).toMatch(/setReload\(/);
  });

  it("lists one removal per entry of the edge, a relation by its property", () => {
    const fn = body("const edgeActions = (edgeId: string) => {", 3000);
    expect(fn).toMatch(/entries\.slice\(0, 5\)/);
    expect(fn).toMatch(/entry\.propertyKey/);
    expect(fn).toMatch(/removeEdgeRelation\(entry\.source, entry\.target, relation\)/);
    expect(fn).toMatch(/removeEdgeTextLinks\(entry\.source, entry\.target\)/);
    expect(fn).toMatch(/danger: true/);
  });
});
