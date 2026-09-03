import { describe, expect, it } from "vitest";
import type { WorkspaceCommentAnchor, WorkspaceCommentRecord } from "@plainva/core";
import { hasOpenAnnotations, renderNoteExport } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The file that leaves Plainva (D10).
 *
 * Comments live beside the note everywhere else - the export is the one place
 * where the opposite is right, because the reader has no other way to see them.
 * These pin what the receiving tool gets: the invisible anchor markers gone in
 * every mode, and the annotations either as a list or as CriticMarkup.
 *
 * The date is injected so the assertions do not depend on the machine locale.
 */

const NOTE = [
  "# Report",
  "",
  "The <!--pv#a1b2-->first claim<!--/pv#a1b2--> needs a source.",
  "",
  "The <!--pv#c3d4-->second claim<!--/pv#c3d4--> is fine.",
  "",
].join("\n");

const names = new Map([
  ["m1", "Ada"],
  ["m2", "Bo"],
]);
const fixed = () => "26 Aug 2026";

function anchor(markerId: string, quote: string): WorkspaceCommentAnchor {
  return { markerId, quote, before: "The ", after: " ", approximateOffset: 0 };
}

function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "notes/report.md",
    targetRevisionId: "",
    parentCommentId: null,
    authorMemberId: "m1",
    authorDeviceId: "d1",
    operationHash: "",
    payloadHash: "",
    body: "",
    anchor: null,
    suggestion: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
    ...over,
  } as WorkspaceCommentRecord;
}

const first = comment({ commentId: "a", anchor: anchor("a1b2", "first claim"), body: "Needs a source." });

function render(comments: WorkspaceCommentRecord[], mode: "plain" | "appendix" | "critic", raw = NOTE) {
  return renderNoteExport({ raw, comments, names, mode, formatDate: fixed });
}

describe("renderNoteExport", () => {
  it("strips the invisible markers in every mode, even without annotations", () => {
    // The markers are Plainva bookkeeping. A note nobody annotated never had
    // one, so nothing changes for anyone who does not use comments - but a note
    // that HAS them must not hand a foreign tool our internal ids.
    const { text, placed, listed } = render([first], "plain");
    expect(text).not.toContain("pv#");
    expect(text).toContain("The first claim needs a source.");
    expect(text).toContain("The second claim is fine.");
    expect(placed).toBe(0);
    expect(listed).toBe(0);
  });

  it("leaves the note untouched and appends the list", () => {
    const { text, placed, listed } = render([first], "appendix");
    // The body above the divider is exactly the plain export - the appendix
    // adds, it never edits.
    const body = text.split("\n---\n")[0];
    expect(body.trimEnd()).toBe(render([first], "plain").text.trimEnd());
    expect(text).toContain(`## ${i18n.t("editor.exportAnnotations")}`);
    expect(text).toContain("first claim");
    expect(text).toContain("Ada");
    expect(text).toContain("26 Aug 2026");
    expect(text).toContain("Needs a source.");
    expect(placed).toBe(0);
    expect(listed).toBe(1);
  });

  it("marks the passage in the text and puts the remark right after it", () => {
    const { text, placed, listed } = render([first], "critic");
    expect(text).toContain("{==first claim==}{>>Ada");
    expect(text).toContain("Needs a source.<<}");
    // Nothing was left over, so there is no list at all - a fallback section on
    // a fully placed export would only make the reader look for something.
    expect(text).not.toContain(`## ${i18n.t("editor.exportAnnotations")}`);
    expect(placed).toBe(1);
    expect(listed).toBe(0);
  });

  it("writes a suggestion as a replacement rather than a highlight", () => {
    const proposal = comment({
      commentId: "s",
      anchor: anchor("a1b2", "first claim"),
      suggestion: { replacement: "first finding", appliedAt: null, appliedBy: null, declinedAt: null },
    });
    const { text } = render([proposal], "critic");
    expect(text).toContain("{~~first claim~>first finding~~}");
    // Even a proposal without a written remark says who proposed it: the
    // receiving tool shows no author of its own.
    expect(text).toContain(`{>>${i18n.t("editor.exportSuggestion")}`);
    expect(text).toContain("Ada");
  });

  it("writes an insertion point as inserted text and a deletion as struck text (V6)", () => {
    const plain = "The first claim needs a source.\n";
    const insertion = comment({
      commentId: "i",
      anchor: { markerId: "", quote: "", before: "first claim", after: " needs", approximateOffset: 15 },
      suggestion: { replacement: " really", appliedAt: null, appliedBy: null, declinedAt: null },
      suggestionBatchId: "r1",
      batchIndex: 0,
      batchNote: "From the PDF",
    });
    const deletion = comment({
      commentId: "x",
      anchor: { markerId: "", quote: "a source", before: "needs ", after: ".", approximateOffset: 22 },
      suggestion: { replacement: "", appliedAt: null, appliedBy: null, declinedAt: null },
      suggestionBatchId: "r1",
      batchIndex: 1,
    });
    const { text, placed, listed } = render([insertion, deletion], "critic", plain);
    expect(text).toContain("The first claim{++ really++}");
    expect(text).toContain("needs {--a source--}");
    // The round's sentence travels once, on its first block.
    expect(text.split("From the PDF").length - 1).toBe(1);
    expect(placed).toBe(2);
    expect(listed).toBe(0);
    const list = render([insertion], "appendix", plain).text;
    expect(list).toContain(i18n.t("editor.exportInsertionPoint", { text: "first claim" }));
    expect(list).toContain(i18n.t("editor.exportSuggestionInsert", { text: "really" }));
    expect(list).toContain(i18n.t("editor.exportRound", { note: "From the PDF" }));
  });

  it("keeps every offset valid by inserting back to front", () => {
    // Two passages, the second AFTER the first. Inserting front to back would
    // shift the second by the length of the first insertion, and its wrap would
    // land inside that markup instead of around the words.
    const second = comment({ commentId: "b", anchor: anchor("c3d4", "second claim"), body: "Agreed." });
    const { text, placed } = render([first, second], "critic");
    expect(placed).toBe(2);
    expect(text.split("{==").length - 1).toBe(2);
    expect(text).toContain("The {==first claim==}{>>Ada");
    expect(text).toContain("The {==second claim==}{>>Ada");
    expect(text).toContain("Agreed.<<} is fine.");
  });

  it("lists a remark about the whole note instead of inventing a passage", () => {
    const whole = comment({ commentId: "w", body: "Reads well overall." });
    const { text, placed, listed } = render([whole], "critic");
    expect(placed).toBe(0);
    expect(listed).toBe(1);
    expect(text).toContain(`### ${i18n.t("editor.exportWholeNote")}`);
    expect(text).toContain(i18n.t("editor.exportAnnotationsUnplaced"));
  });

  it("lists a thread whose passage overlaps one already marked", () => {
    // CriticMarkup does not nest: two wraps around the same words produce a
    // file the receiving tool reads wrongly. The first thread wins the text,
    // the second is still shown - just in the list.
    const nested = [
      "# Report",
      "",
      "<!--pv#a1b2-->The <!--pv#c3d4-->inner<!--/pv#c3d4--> part<!--/pv#a1b2--> stands.",
      "",
    ].join("\n");
    const outer = comment({ commentId: "o", anchor: anchor("a1b2", "The inner part"), body: "Too long." });
    const inner = comment({ commentId: "i", anchor: anchor("c3d4", "inner"), body: "Which one?" });
    const { text, placed, listed } = render([outer, inner], "critic", nested);
    expect(placed).toBe(1);
    expect(listed).toBe(1);
    expect(text.split("{==").length - 1).toBe(1);
    expect(text).toContain("Which one?");
  });

  it("lists a thread whose passage already contains CriticMarkup", () => {
    // Wrapping a passage that carries the delimiters itself would hand the
    // receiving tool a nesting it cannot read.
    const tricky = ["# Report", "", "See <!--pv#a1b2-->{==this==} case<!--/pv#a1b2-->.", ""].join("\n");
    const on = comment({ commentId: "t", anchor: anchor("a1b2", "{==this==} case"), body: "Careful." });
    const { placed, listed } = render([on], "critic", tricky);
    expect(placed).toBe(0);
    expect(listed).toBe(1);
  });

  it("keeps a remark from closing its own marker", () => {
    // Somebody quoting CriticMarkup in a comment must not be able to end the
    // remark early - the rest of the note would land outside it. The escape is
    // a visible space rather than a zero-width character: an invisible fix in a
    // file meant for another tool comes back as a bug report.
    const quoting = comment({ commentId: "q", anchor: anchor("a1b2", "first claim"), body: "Try {>>this<<} here." });
    const { text } = render([quoting], "critic");
    expect(text).toContain("Try { >>this< <} here.");
    expect(text.split("<<}").length - 1).toBe(1);
  });

  it("does not export a settled thread", () => {
    // An export is a handover for review, not an archive - the same definition
    // of "open" the vault-wide overview uses (D9).
    const done = comment({
      commentId: "d",
      anchor: anchor("a1b2", "first claim"),
      body: "Fixed.",
      resolvedAt: "2026-08-26T12:00:00.000Z",
    });
    const applied = comment({
      commentId: "p",
      anchor: anchor("c3d4", "second claim"),
      suggestion: { replacement: "x", appliedAt: "2026-08-26T12:00:00.000Z", appliedBy: "m2", declinedAt: null },
    });
    const { text, listed } = render([done, applied], "appendix");
    expect(listed).toBe(0);
    expect(text).not.toContain(`## ${i18n.t("editor.exportAnnotations")}`);
    expect(text).toBe(render([], "plain").text);
  });

  it("carries a reply along with its root", () => {
    const reply = comment({ commentId: "r", parentCommentId: "a", authorMemberId: "m2", body: "Added one." });
    const { text } = render([first, reply], "appendix");
    expect(text).toContain("Needs a source.");
    expect(text).toContain("Added one.");
    expect(text).toContain("Bo");
  });
});

describe("hasOpenAnnotations", () => {
  it("is the same question the renderer asks", () => {
    // The shells call this BEFORE they ask the user how the annotations should
    // travel. If the two definitions drifted, the dialog would appear for a note
    // that then comes out unchanged.
    expect(hasOpenAnnotations([first], names)).toBe(true);
    expect(hasOpenAnnotations([], names)).toBe(false);
    expect(hasOpenAnnotations([comment({ commentId: "d", resolvedAt: "2026-08-26T12:00:00.000Z" })], names)).toBe(false);
  });
});
