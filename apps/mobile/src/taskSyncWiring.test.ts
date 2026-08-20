import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Where the task reconciler hangs — the one wiring question this whole package
 * turns on.
 *
 * The core worker offers two hooks and they are NOT interchangeable:
 * `onDataChanged` fires only when a cycle wrote fresh provider data, while
 * `onStatusChange` fires at the end of every cycle. Hanging the reconciler on
 * the former looks correct and quietly breaks the direction nobody watches: a
 * task ticked off on the phone while the provider is quiet would never be
 * pushed, because no remote data changed to trigger a run.
 *
 * This reads the source rather than mocking the worker on purpose. The question
 * is not "does the reconciler work" (taskSync.test.ts answers that) but "is it
 * attached to the right event" — and a test built from mocks would happily
 * confirm whichever wiring it was handed.
 */

const SOURCE = readFileSync(new URL("./services/pim/pimService.ts", import.meta.url), "utf8");

/** The body of an object property whose value is an arrow function. */
function handlerBody(source: string, name: string): string {
  const start = source.indexOf(`${name}: (`);
  if (start < 0) throw new Error(`${name} handler not found in pimService`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${name} handler is unbalanced`);
}

describe("mobile task reconciler wiring", () => {
  it("runs at the END of a cycle, so local edits push even when the provider is quiet", () => {
    const onStatusChange = handlerBody(SOURCE, "onStatusChange");
    expect(onStatusChange).toContain("runMobileTaskSync");
    // ...and only once the cycle is actually over.
    expect(onStatusChange).toMatch(/status !== "syncing"[\s\S]*runMobileTaskSync/);
  });

  it("does NOT run only on fresh remote data", () => {
    const onDataChanged = handlerBody(SOURCE, "onDataChanged");
    expect(
      onDataChanged.includes("runMobileTaskSync"),
      "onDataChanged fires only when the provider wrote something; a reconciler " +
        "attached here would never push a task the reader ticked off locally"
    ).toBe(false);
  });
});

/**
 * The other half of the wiring: what happens when the app goes away.
 *
 * Two undo windows run on this shell through the same mechanism and answer the
 * SAME event in opposite ways — mail flushes, a deletion cancels. That is not
 * an inconsistency but the result of asking "what is the safe outcome?" twice,
 * and it is exactly the kind of thing a later tidy-up unifies with the best of
 * intentions. So it is pinned.
 */
const RUNTIME = readFileSync(new URL("./services/pim/taskSyncRuntime.ts", import.meta.url), "utf8");
const COMPOSE = readFileSync(new URL("./screens/MailComposeScreen.tsx", import.meta.url), "utf8");

describe("undo windows on backgrounding", () => {
  it("a pending DELETION is cancelled, never carried out", () => {
    const handler = RUNTIME.slice(RUNTIME.indexOf('addListener("appStateChange"'));
    const body = handler.slice(0, handler.indexOf("\n}"));
    expect(body).toContain("cancelInFlightTaskDeletion");
    expect(
      /flush/i.test(body),
      "flushing here would delete the provider task of someone who merely switched apps"
    ).toBe(false);
  });

  it("a pending SEND is flushed, never cancelled — the opposite, on purpose", () => {
    const handler = COMPOSE.slice(COMPOSE.indexOf('addListener("appStateChange"'));
    const body = handler.slice(0, handler.indexOf("\n}"));
    expect(body).toContain("flush");
  });
});
