// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUX_BRIDGED_EVENTS, WINDOW_LOCAL_EVENTS } from "./auxBridge";

/**
 * The guard behind the aux bridge (finding 2026-09-07).
 *
 * A shared component dispatches a `plainva-*` event and trusts the shell to
 * answer. In the central window that trust is `AppShell`; in an auxiliary
 * window it is `useAuxBridge` — and for six weeks it was nothing: the version
 * history and "reveal in tree" entries of a popped-out note were clickable and
 * did nothing. This test reads the sources of every component an auxiliary
 * pane can render and demands that each event they dispatch is either bridged
 * or declared window-local. A new event without a decision is red here, in
 * the pre-commit.
 *
 * A source scan, not a type: the events are strings, and the shape they are
 * dispatched in (`new CustomEvent("plainva-…")`) is stable enough that the
 * `interactionGrammar` guard rests on the same kind of rule. An event built
 * from a variable would slip past — none is today, and the comment in the
 * table says what to do when one appears.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** What `AuxPane` can render, taken from its own lazy imports. */
function auxPaneComponents(): string[] {
  const src = read("components/AuxPane.tsx");
  const files: string[] = [];
  for (const m of src.matchAll(/import\("\.\/([^"]+)"\)/g)) files.push(`components/${m[1]}.tsx`);
  return files;
}

/**
 * Rendered INSIDE one of those components, with dispatches of its own. Listed
 * by hand: the lazy imports name the panes, not the whole tree under them,
 * and these are the two subtrees that talk to the shell.
 */
const RENDERED_INSIDE = ["components/MarkdownReader.tsx"];

function dispatchedEvents(rel: string): string[] {
  const src = read(rel);
  const names = new Set<string>();
  for (const m of src.matchAll(/new CustomEvent\("(plainva-[a-z0-9-]+)"/g)) names.add(m[1]);
  return [...names].sort();
}

describe("the aux bridge covers every event a pane component dispatches", () => {
  const files = [...auxPaneComponents(), ...RENDERED_INSIDE];

  it("scans the components an auxiliary pane renders", () => {
    // The editor is the one that matters most; a scan that lost it would pass
    // for the wrong reason.
    expect(files).toContain("components/Editor.tsx");
    expect(files).toContain("components/MarkdownReader.tsx");
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const rel of files) {
    it(`${rel}: every dispatched plainva-* event is bridged or declared window-local`, () => {
      const undecided = dispatchedEvents(rel).filter((name) => !(name in AUX_BRIDGED_EVENTS) && !(name in WINDOW_LOCAL_EVENTS));
      expect(undecided, `decide in services/auxBridge.ts what an auxiliary window does with: ${undecided.join(", ")}`).toEqual([]);
    });
  }

  it("does not list an event on both sides", () => {
    const both = Object.keys(AUX_BRIDGED_EVENTS).filter((name) => name in WINDOW_LOCAL_EVENTS);
    expect(both).toEqual([]);
  });

  it("carries the finding's two events, bridged", () => {
    expect(AUX_BRIDGED_EVENTS["plainva-show-version-history"]?.answer).toBe("local");
    expect(AUX_BRIDGED_EVENTS["plainva-reveal-folder"]?.answer).toBe("window-with-tree");
  });

  it("gives every entry a reason", () => {
    for (const [name, entry] of Object.entries(AUX_BRIDGED_EVENTS)) expect(entry.why.length, name).toBeGreaterThan(20);
    for (const [name, why] of Object.entries(WINDOW_LOCAL_EVENTS)) expect(why.length, name).toBeGreaterThan(20);
  });
});
