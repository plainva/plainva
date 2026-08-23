// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content opens once app-wide (multi-window C1). Two claims are kept honest here:
 * the helper every client uses to ask the owner, and — by reading the source —
 * that EVERY door into a pane actually goes through it. The plan calls the
 * second one a check point, not a footnote: a rule that guards one reported
 * door is a rule that lives in one place only.
 */

let busForTest: { request: (name: string, args: unknown) => Promise<unknown> } | null = null;
vi.mock("./windowBus", () => ({
  getWindowBus: async () => {
    if (!busForTest) throw new Error("no bus");
    return busForTest;
  },
}));

import { routeOpenThroughOwner } from "./openRouting";

/** The answer arrives asynchronously; let the microtask queue drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  busForTest = null;
});

describe("asking the owner where content should be drawn", () => {
  it("stays quiet when another window already holds it", async () => {
    const asked: unknown[] = [];
    busForTest = {
      request: async (_n, args) => {
        asked.push(args);
        return { where: "owner" };
      },
    };
    let drawnHere = 0;

    const handled = routeOpenThroughOwner("Note.md", () => drawnHere++, { from: "full-1" });
    await settle();

    // The owner brought the holding window forward; drawing it here as well is
    // exactly the second copy the rule exists to prevent.
    expect(drawnHere).toBe(0);
    expect(asked).toEqual([{ path: "Note.md", from: "full-1", newWindow: undefined }]);
    // Always true: the caller must stop now, because the answer is not in yet.
    expect(handled).toBe(true);
  });

  it("draws it here when nobody has it", async () => {
    busForTest = { request: async () => ({ where: "caller" }) };
    let drawnHere = 0;

    routeOpenThroughOwner("Fresh.md", () => drawnHere++, { from: "full-1" });
    await settle();

    expect(drawnHere).toBe(1);
  });

  it("draws it here when there is no bus at all", async () => {
    busForTest = null; // browser, test harness, or an owner that never answered
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let drawnHere = 0;

    routeOpenThroughOwner("Fresh.md", () => drawnHere++);
    await settle();

    // Worse than a duplicate window is a dead click.
    expect(drawnHere).toBe(1);
    warn.mockRestore();
  });

  it("passes a new-window request on rather than deciding locally", async () => {
    const asked: Array<Record<string, unknown>> = [];
    busForTest = {
      request: async (_n, args) => {
        asked.push(args as Record<string, unknown>);
        return { where: "owner" };
      },
    };

    routeOpenThroughOwner("Note.md", () => {}, { from: "full-1", newWindow: true });
    await settle();

    expect(asked[0]?.newWindow).toBe(true);
  });
});

/** The body of a `const <name> = useCallback(...)` block, up to the next one. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} should exist in usePaneLayout`).toBeGreaterThan(-1);
  const rest = source.slice(start + 10);
  const next = rest.indexOf("\n  const ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("every door into a pane asks first", () => {
  const source = readFileSync(join(__dirname, "..", "hooks", "usePaneLayout.ts"), "utf8");

  // The four ways a path reaches a pane. Every entry point in the app — file
  // tree, search hit, bookmark, backlink, graph node, database row, palette —
  // funnels through one of these, which is why the guard sits here and not at
  // twenty call sites.
  for (const door of ["openTab", "openInFocusedPane", "openInOtherPane", "openPathInSplit"]) {
    it(`${door} routes through the owner before drawing`, () => {
      const body = callbackBody(source, door);
      expect(body).toContain("routedToAnotherWindow(");
    });
  }

  it("hands attachments to the system before asking anyone", () => {
    // An attachment never becomes a tab, so routing it would ask about content
    // that no window can hold.
    for (const door of ["openTab", "openInFocusedPane", "openPathInSplit"]) {
      const body = callbackBody(source, door);
      expect(body.indexOf("handedToTheSystem("), door).toBeLessThan(body.indexOf("routedToAnotherWindow("));
    }
  });

  it("does not route the second half of a decision already made", () => {
    // `openView` asks the owner and THEN calls this to focus or create the tab;
    // routing here as well would be a second round trip for the same click.
    expect(callbackBody(source, "focusOrOpenVirtual")).not.toContain("routedToAnotherWindow(");
  });
});
