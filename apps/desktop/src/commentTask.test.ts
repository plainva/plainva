import { describe, expect, it } from "vitest";
import { commentTaskReply, commentTaskTitle, commentTaskTrailer } from "@plainva/ui";

/**
 * A comment that became work (D11).
 *
 * The pieces are pure on purpose: both shells build the same title, the same
 * trailer and the same reply, so a task made on the phone is indistinguishable
 * from one made on the desktop. What is pinned here is the SHAPE of those three
 * strings - never a translation, which is why every label is passed in.
 */

describe("commentTaskTitle", () => {
  it("takes the first line, because that is what the author led with", () => {
    expect(commentTaskTitle("Source is missing\n\nSee page 12.", "Comment")).toBe("Source is missing");
  });

  it("skips leading blank lines rather than titling a task with nothing", () => {
    expect(commentTaskTitle("\n\n  Check the numbers  ", "Comment")).toBe("Check the numbers");
  });

  it("flattens a wrapped first line into one", () => {
    // A title is one line by definition; a newline inside it would land in the
    // file name the database derives from it.
    expect(commentTaskTitle("Two   words\tapart", "Comment")).toBe("Two words apart");
  });

  it("falls back when the body carries no words at all", () => {
    // A resolve carries an empty body. Promoting one is unusual but not
    // forbidden, and an empty title would produce an unnamed note.
    expect(commentTaskTitle("   \n\n", "Comment")).toBe("Comment");
  });

  it("caps a long line instead of handing the file system a paragraph", () => {
    const title = commentTaskTitle("x".repeat(200), "Comment");
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("leaves a written mention as it stands", () => {
    // Mentions are stored as the written `@Name`, not as member ids - so the
    // title reads as a sentence with no lookup at all.
    expect(commentTaskTitle("@Ada please verify this", "Comment")).toBe("@Ada please verify this");
  });
});

describe("commentTaskTrailer", () => {
  it("carries the remark, the passage and the way back", () => {
    const trailer = commentTaskTrailer({
      body: "Needs a source.",
      quote: "the first claim",
      noteTarget: "Report",
      sourceLabel: "From a comment in",
    });
    expect(trailer).toContain("Needs a source.");
    // A blockquote already reads as the quoted passage - a second label above
    // it would only repeat what the formatting says.
    expect(trailer).toContain("> the first claim");
    expect(trailer).toContain("From a comment in: [[Report]]");
  });

  it("still points home when there is no passage", () => {
    // A remark about the whole note has no quote. The link is the part that
    // must never be missing: without it the task is orphaned prose.
    const trailer = commentTaskTrailer({ body: "Reads well.", quote: null, noteTarget: "Report", sourceLabel: "From" });
    expect(trailer).not.toContain(">");
    expect(trailer).toContain("From: [[Report]]");
  });

  it("flattens and caps a long passage", () => {
    const trailer = commentTaskTrailer({
      body: "",
      quote: `${"y".repeat(200)}\nsecond line`,
      noteTarget: "Report",
      sourceLabel: "From",
    });
    const quoteLine = trailer.split("\n").find((line) => line.startsWith("> ")) ?? "";
    // A quote that wrapped in the note would otherwise break out of the
    // blockquote on its second line and read as body text of the task.
    expect(quoteLine).toHaveLength(82);
    expect(quoteLine.endsWith("…")).toBe(true);
  });
});

describe("commentTaskReply", () => {
  it("names the task, because the comment itself cannot be rewritten", () => {
    // The log is append-only: the reply IS the back-reference. Anything that
    // "edits the comment to mention the task" would be a second truth.
    expect(commentTaskReply("Tasks/Source missing", "Created as a task")).toBe(
      "Created as a task: [[Tasks/Source missing]]",
    );
  });
});
