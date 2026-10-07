import { describe, expect, it } from "vitest";
import { readFrontmatterPath, setFrontmatterPath } from "../../frontmatter-surgical.js";
import { MAX_ANCHOR_QUOTE_BYTES, buildCommentAnchor, mintAnchorMarkerId, resolveCommentAnchor } from "../../workspace/commentAnchor.js";
import { PROPERTY_WRITE_LIMITS, planPropertyChange, propertyTarget, proposedPropertyOf, type PropertyChangePlan, type PropertyValue } from "./properties.js";

const NOTE = ["---", "status: open", "tags:", "  - roof", "  - house", "due: 2026-11-01", "---", "# Plan", "", "status: open is also a sentence here.", ""].join("\n");

/** The plan, which has to be one; and what accepting its block as a plain text change gives. */
function planned(base: string, key: string, value: PropertyValue | null): Extract<PropertyChangePlan, { ok: true }> {
  const plan = planPropertyChange(base, key, value);
  if (!plan.ok) throw new Error(`no plan: ${plan.problem}`);
  if (plan.block) expect(base.slice(0, plan.block.from) + plan.block.replacement + base.slice(plan.block.to)).toBe(plan.intended);
  return plan;
}

describe("what a write to a property is (propertyTarget)", () => {
  it("takes an ordinary property as a suggestion", () => {
    expect(propertyTarget(NOTE, "due", "2026-12-01")).toEqual({ class: "plain", path: ["due"] });
    expect(propertyTarget(NOTE, " priority ", 2)).toEqual({ class: "plain", path: ["priority"] });
    expect(propertyTarget(NOTE, "tags", ["roof", "garden"])).toEqual({ class: "plain", path: ["tags"] });
    expect(propertyTarget(NOTE, "due", null)).toEqual({ class: "plain", path: ["due"] });
  });

  it("tells a task's status from a note's lifecycle by its form", () => {
    // A task database's own values: an ordinary property.
    expect(propertyTarget(NOTE, "status", "done").class).toBe("plain");
    // The lifecycle's values are not an assistant's to set ...
    expect(propertyTarget(NOTE, "status", "stable").class).toBe("trust");
    // ... and where the note uses the key as its lifecycle, nothing about it is.
    const lifecycle = NOTE.replace("status: open", "status: draft");
    expect(propertyTarget(lifecycle, "status", "done").class).toBe("trust");
    expect(propertyTarget(lifecycle, "status", null).class).toBe("trust");
  });

  it("never lets who made a note and who vouches for it be written", () => {
    const stamp = { by: "human:ada", at: "2026-10-07T10:00:00Z" };
    const stamped = setFrontmatterPath(NOTE, ["generated"], { by: "plainva-ai/x", at: "2026-10-07T10:00:00Z" });
    expect(propertyTarget(stamped, "generated", null).class).toBe("trust");
    expect(propertyTarget(stamped, "generated", "me").class).toBe("trust");
    expect(propertyTarget(NOTE, "stale_after", "2027-01-01").class).toBe("trust");
    // A value of the form the fields have cannot even be stated here: a suggestion sets text, numbers and lists of them.
    expect(propertyTarget(NOTE, "verified", [stamp] as unknown as PropertyValue).class).toBe("invalid");
    // Text under one of the names, on a note that does not use it as a trust field, is a property like any other.
    expect(propertyTarget(NOTE, "sources", "the roofer's letter").class).toBe("plain");
  });

  it("knows the note's two AI rules, and that they are no suggestion", () => {
    expect(propertyTarget(NOTE, "plainva.ai.cloud", "deny")).toEqual({ class: "rules", path: ["plainva", "ai", "cloud"], rule: "cloud" });
    expect(propertyTarget(NOTE, "plainva.ai.web", null)).toEqual({ class: "rules", path: ["plainva", "ai", "web"], rule: "web" });
    expect(propertyTarget(NOTE, "plainva.ai.cloud", "allow").class).toBe("invalid");
    expect(propertyTarget(NOTE, "plainva.ai.local", "deny").class).toBe("reserved");
    expect(propertyTarget(NOTE, "plainva", "x").class).toBe("reserved");
    expect(propertyTarget(NOTE, "plainva.icon", "x").class).toBe("reserved");
  });

  it("refuses a name that is none and a value that is none", () => {
    expect(propertyTarget(NOTE, "  ", "x").class).toBe("invalid");
    expect(propertyTarget(NOTE, "a\nb", "x").class).toBe("invalid");
    expect(propertyTarget(NOTE, "k".repeat(PROPERTY_WRITE_LIMITS.key + 1), "x").class).toBe("invalid");
    expect(propertyTarget(NOTE, "due", "x".repeat(PROPERTY_WRITE_LIMITS.text + 1)).class).toBe("invalid");
    expect(propertyTarget(NOTE, "due", Number.NaN).class).toBe("invalid");
    expect(propertyTarget(NOTE, "tags", Array.from({ length: PROPERTY_WRITE_LIMITS.items + 1 }, () => "x")).class).toBe("invalid");
    expect(propertyTarget(NOTE, "tags", [["nested"]] as unknown as PropertyValue).class).toBe("invalid");
  });
});

describe("a proposed value as one block of the note (planPropertyChange)", () => {
  it("replaces the property's own line and no other", () => {
    const plan = planned(NOTE, "status", "done");
    expect(plan.intended).toBe(NOTE.replace("status: open\ntags", "status: done\ntags"));
    expect(plan.block).toEqual({ from: 4, to: 16, replacement: "status: done" });
    expect(plan.hinted).toBe(true);
    expect(plan.current).toBe("open");
  });

  it("takes a list with all its lines", () => {
    const plan = planned(NOTE, "tags", ["roof", "house", "garden"]);
    expect(NOTE.slice(plan.block!.from, plan.block!.to)).toBe("tags:\n  - roof\n  - house");
    expect(plan.block!.replacement).toBe("tags:\n  - roof\n  - house\n  - garden");
    expect(readFrontmatterPath(plan.intended, ["tags"])).toEqual(["roof", "house", "garden"]);
    expect(plan.hinted).toBe(true);
  });

  it("puts a new property in front of the line that closes the properties", () => {
    const plan = planned(NOTE, "priority", "high");
    expect(plan.intended).toBe(NOTE.replace("due: 2026-11-01\n---", "due: 2026-11-01\npriority: high\n---"));
    expect(plan.block).toEqual({ from: NOTE.indexOf("---\n# Plan"), to: NOTE.indexOf("---\n# Plan"), replacement: "priority: high\n" });
    // An insertion quotes nothing, so its anchor can carry no hint.
    expect(plan.hinted).toBe(false);
    expect(plan.current).toBeUndefined();
  });

  it("removes a property with its line", () => {
    const middle = planned(NOTE, "status", null);
    expect(middle.intended).toBe(NOTE.replace("status: open\n", ""));
    expect(middle.hinted).toBe(true);
    const last = planned(NOTE, "due", null);
    expect(last.intended).toBe(NOTE.replace("due: 2026-11-01\n", ""));
    expect(NOTE.slice(last.block!.from, last.block!.to)).toBe("\ndue: 2026-11-01");
  });

  it("leaves comments, blank lines and every other property as they are written", () => {
    const base = ["---", "# who and when", "status:   open   # checked on Monday", "", "# the rest", "tags: [roof, house]", "---", "Text", ""].join("\n");
    const plan = planned(base, "status", "done");
    expect(plan.intended).toBe(base.replace("status:   open   # checked on Monday", "status: done"));
    const more = planned(base, "tags", ["roof"]);
    expect(more.intended).toBe(base.replace("tags: [roof, house]", "tags:\n  - roof"));
  });

  it("writes a properties block where the note has none", () => {
    const plan = planned("# Plan\n\nText\n", "status", "open");
    expect(plan.intended).toBe("---\nstatus: open\n---\n# Plan\n\nText\n");
    expect(plan.block).toEqual({ from: 0, to: 0, replacement: "---\nstatus: open\n---\n" });
    expect(plan.hinted).toBe(false);
  });

  it("keeps a note's line endings", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const plan = planned(crlf, "tags", ["roof"]);
    expect(plan.intended).toBe(crlf.replace("tags:\r\n  - roof\r\n  - house", "tags:\r\n  - roof"));
    const added = planned(crlf, "priority", "high");
    expect(added.block!.replacement).toBe("priority: high\r\n");
    expect(/[^\r]\n/.test(added.intended)).toBe(false);
  });

  it("writes a value the way it reads back as the same value", () => {
    for (const value of ["007", "yes", "a: b", "- x", "#tag", "line one\nline two", "", " padded ", 12.5, true, ["a, b", "c"]] as PropertyValue[]) {
      const plan = planned(NOTE, "note", value);
      expect(readFrontmatterPath(plan.intended, ["note"]), JSON.stringify(value)).toEqual(value);
      // Everything else still says what it said.
      expect(readFrontmatterPath(plan.intended, ["tags"])).toEqual(["roof", "house"]);
      expect(plan.intended.endsWith(NOTE.slice(NOTE.indexOf("# Plan")))).toBe(true);
    }
  });

  it("says so where nothing would change", () => {
    expect(planPropertyChange(NOTE, "status", "open")).toEqual({ ok: false, problem: "unchanged" });
    expect(planPropertyChange(NOTE, "tags", ["roof", "house"])).toEqual({ ok: false, problem: "unchanged" });
    expect(planPropertyChange(NOTE, "priority", null)).toEqual({ ok: false, problem: "unchanged" });
    // A list in another order is another list.
    expect(planPropertyChange(NOTE, "tags", ["house", "roof"]).ok).toBe(true);
  });

  it("does not touch properties it cannot read", () => {
    expect(planPropertyChange("---\ntags: [roof\n---\nText\n", "status", "open")).toEqual({ ok: false, problem: "unreadable" });
  });

  it("falls back to the whole properties where they are not written entry by entry", () => {
    const flow = "---\n{status: open, tags: [roof]}\n---\nText\n";
    const plan = planned(flow, "status", "done");
    expect(plan.block).toBeNull();
    expect(plan.hinted).toBe(false);
    expect(readFrontmatterPath(plan.intended, ["status"])).toBe("done");
    expect(readFrontmatterPath(plan.intended, ["tags"])).toEqual(["roof"]);
    // The last property removed: the block that stays is the oracle's.
    const only = planned("---\nstatus: open\n---\nText\n", "status", null);
    expect(only.block).toBeNull();
    expect(only.intended).toBe("---\n---\nText\n");
  });

  it("gives no hint where the entry is longer than an anchor quotes", () => {
    const long = setFrontmatterPath(NOTE, ["summary"], "word ".repeat(MAX_ANCHOR_QUOTE_BYTES / 4).trim());
    const plan = planned(long, "summary", "short");
    expect(plan.block).not.toBeNull();
    expect(plan.hinted).toBe(false);
    expect(readFrontmatterPath(plan.intended, ["summary"])).toBe("short");
  });
});

describe("the property a suggestion proposes (proposedPropertyOf)", () => {
  const anchored = (base: string, key: string, value: PropertyValue | null) => {
    const plan = planned(base, key, value);
    const block = plan.block!;
    const anchor = buildCommentAnchor(base, block.from, block.to, mintAnchorMarkerId(base), plan.hinted ? { kind: "property", key } : undefined);
    return { plan, block, anchor };
  };

  it("reads a replaced value by the hint at its anchor", () => {
    const { anchor, block } = anchored(NOTE, "status", "done");
    expect(anchor.display).toEqual({ kind: "property", key: "status" });
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "status", value: "done", removed: false });
    const list = anchored(NOTE, "tags", ["roof"]);
    expect(proposedPropertyOf(list.anchor, list.block.replacement)).toEqual({ key: "tags", value: ["roof"], removed: false });
  });

  it("reads a removal", () => {
    const { anchor, block } = anchored(NOTE, "due", null);
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "due", value: undefined, removed: true });
  });

  it("reads a new property from the entry and the place it is inserted at", () => {
    const { anchor, block } = anchored(NOTE, "priority", "high");
    expect(anchor.quote).toBe("");
    expect(anchor.display).toBeUndefined();
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "priority", value: "high", removed: false });
    const fresh = anchored("# Plan\n\nText\n", "status", "open");
    expect(proposedPropertyOf(fresh.anchor, fresh.block.replacement)).toEqual({ key: "status", value: "open", removed: false });
  });

  it("takes a passage for a passage", () => {
    const at = NOTE.indexOf("is also a sentence");
    const anchor = buildCommentAnchor(NOTE, at, at + 7, mintAnchorMarkerId(NOTE));
    expect(proposedPropertyOf(anchor, "was once")).toBeNull();
    // An insertion somewhere in the text, even of something that looks like an entry.
    const point = buildCommentAnchor(NOTE, at, at, mintAnchorMarkerId(NOTE));
    expect(proposedPropertyOf(point, "status: done\n")).toBeNull();
    // A hint whose text sets another property is not believed.
    const { anchor: hinted } = anchored(NOTE, "status", "done");
    expect(proposedPropertyOf(hinted, "due: 2027-01-01")).toBeNull();
    expect(proposedPropertyOf(hinted, "status: done\ndue: 2027-01-01")).toBeNull();
  });

  it("is found again by an app that only knows passages — and accepting it there gives the same note", () => {
    for (const [key, value] of [["status", "done"], ["tags", ["roof"]], ["due", null], ["priority", "high"]] as [string, PropertyValue | null][]) {
      const { plan, block, anchor } = anchored(NOTE, key, value);
      const place = resolveCommentAnchor(NOTE, anchor);
      if (place.status === "orphan") throw new Error(`orphan: ${key}`);
      expect(place.status, key).toBe("quote");
      expect(NOTE.slice(0, place.from) + block.replacement + NOTE.slice(place.to), key).toBe(plan.intended);
    }
  });

  it("is an orphan once the value it was written against is gone", () => {
    const { anchor } = anchored(NOTE, "due", "2026-12-01");
    const moved = NOTE.replace("due: 2026-11-01", "due: 2026-11-15");
    expect(resolveCommentAnchor(moved, anchor).status).toBe("orphan");
  });
});
