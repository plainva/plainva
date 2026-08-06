// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GroupCard, Row, RowList, SectionLabel } from "@plainva/ui";

/**
 * The container grammar in the MOBILE shell (N2.1).
 *
 * The primitive is shared, so the interesting question here is not whether it
 * renders — the desktop suite already shows that — but whether the one thing
 * that differs between the shells is the only thing that differs. A phone row
 * is not a different row; it is the same row with more to aim at.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

/**
 * The working directory is the package root under turbo and `src/` when vitest
 * is run directly, so both are tried rather than one being assumed.
 */
function readFrom(candidates: string[], name: string): string {
  for (const dir of candidates) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error(`cannot locate ${name} from ${process.cwd()}`);
}

const readShared = (name: string) =>
  readFrom(
    [
      join(process.cwd(), "..", "..", "packages", "ui", "src", "styles"),
      join(process.cwd(), "..", "..", "..", "packages", "ui", "src", "styles"),
    ],
    name,
  );

const readShell = (name: string) => readFrom([process.cwd(), join(process.cwd(), "src")], name);

describe("the container grammar renders in the mobile shell", () => {
  it("resolves from the shared package and produces the grouped markup", () => {
    render(
      <>
        <SectionLabel end={2}>Verbindung</SectionLabel>
        <GroupCard>
          <RowList>
            <Row end="›" subtitle="anna@example.org" title="Google Drive" />
            <Row indent={1} title="Dateien · Kalender" />
          </RowList>
        </GroupCard>
      </>,
    );
    expect(container.querySelector(".pv-grouplabel")).not.toBeNull();
    expect(container.querySelector(".pv-card--flush")).not.toBeNull();
    expect(container.querySelectorAll(".pv-grouprow")).toHaveLength(2);
    expect(container.querySelector(".pv-grouprow--indent")).not.toBeNull();
  });

  it("loads the shared stylesheets that carry it", () => {
    // Both shells import these; without them the classes above would render
    // as unstyled divs on the phone while looking right on the desktop.
    const main = readShell("main.tsx");
    expect(main).toContain("@plainva/ui/styles/tokens.css");
    expect(main).toContain("@plainva/ui/styles/ui.css");
  });

  it("differs from the desktop in the row HEIGHT and nothing else", () => {
    const tokens = readShared("tokens.css");
    const touch = tokens.slice(tokens.indexOf('[data-density="touch"]'));
    const block = touch.slice(0, touch.indexOf("}"));
    const rowVars = [...block.matchAll(/--pv-row-[a-z0-9-]+/g)].map((m) => m[0]);
    expect(
      rowVars,
      "the touch density changes more of the row than its height — a phone row must be the same row",
    ).toEqual(["--pv-row-min"]);
    expect(block).toContain("--pv-row-min: var(--touch-row)");
  });

  it("states the metric once, in the tokens, and not in the rules", () => {
    const css = readShared("ui.css");
    const start = css.indexOf(".pv-grouprow {");
    const rule = css.slice(start, css.indexOf("}", start));
    // A raw metric here would be a second place that decides the rhythm. The
    // hairline is excluded on purpose: a 1px border is a line, not a measure.
    const metric = rule
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("border"))
      .join("\n");
    expect(metric).not.toMatch(/\d+px/);
    expect(metric).toContain("var(--pv-row-min)");
    expect(metric).toContain("var(--pv-row-pad-y) var(--pv-row-pad-x)");
  });
});
