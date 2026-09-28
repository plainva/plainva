import { describe, expect, it } from "vitest";
import { inferType, markdownToHtml, markdownToPlainText, parseCalloutMarker, parsePropertyFilter } from "@plainva/ui";
import { carryMirroredHeading } from "./services/fileActions";

/**
 * Line grammars read in linear time (plan Befunde 24.09., E6): headings and
 * quotes in both copies, callout headers, the mirrored heading a rename
 * carries, comparison filters and the e-mail shape of a property. Each hostile
 * case is what an old pattern needed quadratic (the heading: cubic) time for.
 * The pins are readings of the old patterns, quirks included; the functions'
 * own behaviour tests (markdownToHtml, markdownToPlainText, callouts,
 * fileActions, filterExpr, propertyModel) ran unchanged across the rewrite.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("headings and quotes in both copies", () => {
  it("read as before", () => {
    expect(markdownToHtml("# Title #")).toBe("<h1>Title</h1>");
    expect(markdownToHtml("# #")).toBe("<h1>#</h1>");
    expect(markdownToHtml("## Title\r")).toBe("<h2>Title</h2>");
    expect(markdownToHtml("> quoted\n> more")).toBe("<blockquote>quoted<br>more</blockquote>");
    expect(markdownToPlainText("# Title #")).toBe("Title");
    expect(markdownToPlainText("> # Inner")).toBe("Inner");
    expect(markdownToPlainText("## Title\r")).toBe("Title");
  });

  it("run in one pass over a long run of blanks or markers", () => {
    for (const line of [`#${" ".repeat(N)}x\ry`, `# a${" ".repeat(N)}#\rb`, `${">".repeat(N)}\r`, `${"> ".repeat(N / 2)}\r`]) {
      within(2_000, () => markdownToHtml(line));
      within(2_000, () => markdownToPlainText(line));
    }
  });

  it("peels deeply nested quotes without running out of stack", () => {
    // `>  >` nests one quote per marker; the plain-text copy recursed per level
    // and threw a RangeError at about 20 000 of them.
    expect(markdownToPlainText(">  >  > # Deep")).toBe("Deep");
    expect(markdownToPlainText(">  >  ---")).toBe("");
    let plain = "";
    within(2_000, () => { plain = markdownToPlainText(`${">  ".repeat(30_000)}x`); });
    // The last `>  x` leaves " x", as one level always did.
    expect(plain).toBe(" x");
  });
});

describe("callout header", () => {
  it("reads as before", () => {
    expect(parseCalloutMarker("[!info]")).toEqual({ type: "info", title: "" });
    expect(parseCalloutMarker("[!Warning]- Collapsed")).toEqual({ type: "warning", title: "Collapsed" });
    expect(parseCalloutMarker("  [!NOTE]+  Title  ")).toEqual({ type: "note", title: "Title" });
    // The blanks after the marker may cross a line break; the title may not hold one.
    expect(parseCalloutMarker("[!tip]\nnext")).toEqual({ type: "tip", title: "next" });
    expect(parseCalloutMarker("[!tip] a\nb")).toBeNull();
    expect(parseCalloutMarker("[!in fo]")).toBeNull();
  });

  it("runs in one pass over a long run of blanks", () => {
    within(1_000, () => expect(parseCalloutMarker(`[!info]${" ".repeat(N)}x\ny`)).toBeNull());
  });
});

describe("the mirrored heading a rename carries", () => {
  it("reads as before", () => {
    expect(carryMirroredHeading("\n\n  ## Task_1 \t\nBody", "Task_1", "New")).toBe("\n\n  ## New \t\nBody");
    expect(carryMirroredHeading("\n#   Task_1  \r\nx", "Task_1", "New")).toBe("\n#   New  \r\nx");
    expect(carryMirroredHeading("Intro\n# Task_1", "Task_1", "New")).toBeNull();
  });

  it("runs in one pass over a long run", () => {
    within(1_000, () => expect(carryMirroredHeading(`${"\n".repeat(N)}x`, "x", "y")).toBeNull());
    within(1_000, () => expect(carryMirroredHeading(`# a${" ".repeat(N)}b\r`, "a", "y")).toBeNull());
  });
});

describe("comparison filters and the e-mail shape", () => {
  it("read as before", () => {
    expect(parsePropertyFilter('status  >=  "3"')).toEqual({ column: "status", op: ">=", value: "3" });
    expect(parsePropertyFilter('x == ""')).toEqual({ column: "x", op: "empty", value: "" });
    expect(inferType("me@example.org", "k")).toBe("email");
    expect(inferType("me@example.", "k")).toBe("text");
    expect(inferType("me@.org", "k")).toBe("text");
  });

  it("run in one pass over a long run", () => {
    within(1_000, () => expect(parsePropertyFilter(`a${" ".repeat(N)}x"`)).toBeNull());
    within(1_000, () => expect(inferType(`a@${".".repeat(N)}@`, "k")).toBe("text"));
  });
});
