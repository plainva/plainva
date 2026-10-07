import { describe, expect, it } from "vitest";
import { planCommentDecision } from "../../comments/commentActions.js";
import { isReservedPropertyName, readFrontmatterPath, setFrontmatterPath } from "../../frontmatter-surgical.js";
import { MAX_ANCHOR_QUOTE_BYTES, buildCommentAnchor, mintAnchorMarkerId, resolveCommentAnchor } from "../../workspace/commentAnchor.js";
import type { WorkspaceCommentRecord } from "../../workspace/state.js";
import { PROPERTY_WRITE_LIMITS, placeProposedProperty, planPropertyChange, propertyTarget, proposedPropertyOf, type PropertyChangePlan, type PropertyValue } from "./properties.js";

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
    // Who made a note, who vouches for it and what it rests on are trust fields by their name: text under one of
    // them is nothing an assistant proposes either, on whatever note — the app's own "add a property" takes none.
    expect(propertyTarget(NOTE, "sources", "the roofer's letter").class).toBe("trust");
    expect(propertyTarget(NOTE, "generated", "me").class).toBe("trust");
    expect(propertyTarget(NOTE, "Verified", true).class).toBe("trust");
  });

  it("knows the note's two AI rules, and that they are no suggestion", () => {
    expect(propertyTarget(NOTE, "plainva.ai.cloud", "deny")).toEqual({ class: "rules", path: ["plainva", "ai", "cloud"], rule: "cloud" });
    expect(propertyTarget(NOTE, "plainva.ai.web", null)).toEqual({ class: "rules", path: ["plainva", "ai", "web"], rule: "web" });
    expect(propertyTarget(NOTE, "plainva.ai.cloud", "allow").class).toBe("invalid");
    expect(propertyTarget(NOTE, "plainva.ai.local", "deny").class).toBe("reserved");
    expect(propertyTarget(NOTE, "plainva", "x").class).toBe("reserved");
    expect(propertyTarget(NOTE, "plainva.icon", "x").class).toBe("reserved");
  });

  it("takes no name the app's own way of adding a property refuses", () => {
    // Plainva's namespace in every spelling, a database's virtual columns, the note's type and format marker, and
    // the names that would reach into an object's prototype once the properties are read.
    for (const name of ["Plainva.AI.cloud", "plainva:icon", "PLAINVA", "file.name", "File.mtime", "formula.total", "type", "Type", "okf_version", "__proto__", "prototype", "constructor"]) {
      expect(isReservedPropertyName(name), name).toBe(true);
      expect(propertyTarget(NOTE, name, "x").class, name).toBe("reserved");
      expect(propertyTarget(NOTE, name, null).class, name).toBe("reserved");
    }
    // Every name it refuses is refused here too — under whichever of the two words.
    for (const name of ["generated", "verified", "sources"]) {
      expect(isReservedPropertyName(name), name).toBe(true);
      expect(propertyTarget(NOTE, name, "x").class, name).toBe("trust");
    }
    for (const name of ["typeface", "files", "formulas", "plainvanilla", "prototypes", "source"]) {
      expect(isReservedPropertyName(name), name).toBe(false);
      expect(propertyTarget(NOTE, name, "x").class, name).toBe("plain");
    }
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
    // With the value the property had when the suggestion was made: the anchor quotes its entry as it stood.
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "status", value: "done", removed: false, added: false, previous: "open", form: "entry" });
    const list = anchored(NOTE, "tags", ["roof"]);
    expect(proposedPropertyOf(list.anchor, list.block.replacement)).toEqual({ key: "tags", value: ["roof"], removed: false, added: false, previous: ["roof", "house"], form: "entry" });
  });

  it("reads a removal", () => {
    const { anchor, block } = anchored(NOTE, "due", null);
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "due", value: undefined, removed: true, added: false, previous: "2026-11-01", form: "entry" });
  });

  it("reads a new property from the entry and the place it is inserted at", () => {
    const { anchor, block } = anchored(NOTE, "priority", "high");
    expect(anchor.quote).toBe("");
    expect(anchor.display).toBeUndefined();
    expect(proposedPropertyOf(anchor, block.replacement)).toEqual({ key: "priority", value: "high", removed: false, added: true, previous: undefined, form: "insert" });
    const fresh = anchored("# Plan\n\nText\n", "status", "open");
    expect(proposedPropertyOf(fresh.anchor, fresh.block.replacement)).toEqual({ key: "status", value: "open", removed: false, added: true, previous: undefined, form: "block" });
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

describe("where a proposed property goes in the note as it is now (placeProposedProperty)", () => {
  /** A suggestion made against `base`, placed in `now` the way a decision and a card ask. */
  const suggested = (base: string, key: string, value: PropertyValue | null) => {
    const plan = planned(base, key, value);
    const block = plan.block!;
    const anchor = buildCommentAnchor(base, block.from, block.to, mintAnchorMarkerId(base), plan.hinted ? { kind: "property", key } : undefined);
    const placeIn = (now: string) => {
      const found = resolveCommentAnchor(now, anchor);
      return placeProposedProperty(now, anchor, block.replacement, found.status === "orphan" ? null : found);
    };
    /** The note after accepting; null where the suggestion does not fit (or is no property here). */
    const acceptedIn = (now: string) => {
      const place = placeIn(now);
      return place?.fits ? now.slice(0, place.from) + place.replacement + now.slice(place.to) : null;
    };
    return { plan, placeIn, acceptedIn };
  };

  it("applies every form where it was proposed while the note is as it was", () => {
    for (const [key, value] of [["status", "done"], ["tags", ["roof"]], ["due", null], ["priority", "high"]] as [string, PropertyValue | null][]) {
      const { plan, acceptedIn } = suggested(NOTE, key, value);
      expect(acceptedIn(NOTE), key).toBe(plan.intended);
    }
    const bare = "# Plan\n\nText\n";
    const first = suggested(bare, "status", "open");
    expect(first.acceptedIn(bare)).toBe(first.plan.intended);
  });

  it("never takes the same words in the text for the property's entry", () => {
    const { placeIn, acceptedIn } = suggested(NOTE, "status", "done");
    // The value changed since. What still reads "status: open" is a sentence of the text — found by its words, and no entry.
    const changed = NOTE.replace("---\nstatus: open", "---\nstatus: waiting");
    expect(resolveCommentAnchor(changed, buildCommentAnchor(NOTE, 4, 16, mintAnchorMarkerId(NOTE), { kind: "property", key: "status" })).status).toBe("quote");
    expect(placeIn(changed)).toMatchObject({ fits: false, property: { key: "status", form: "entry" } });
    expect(acceptedIn(changed)).toBeNull();
    // The property is gone altogether, or the note has no properties any more.
    expect(placeIn(NOTE.replace("status: open\n", ""))).toMatchObject({ fits: false });
    expect(placeIn("# Plan\n\nstatus: open is also a sentence here.\n")).toMatchObject({ fits: false });
  });

  it("still fits when other properties changed around it", () => {
    const { acceptedIn } = suggested(NOTE, "status", "done");
    const around = NOTE.replace("due: 2026-11-01", "due: 2026-12-24\nowner: Anna");
    expect(acceptedIn(around)).toBe(around.replace("---\nstatus: open", "---\nstatus: done"));
  });

  it("puts a new property in front of the line that closes the properties as they are now", () => {
    const { acceptedIn, placeIn } = suggested(NOTE, "priority", "high");
    // Another property was added in the meantime — a list, whose items a line slipped in after the old last entry would split.
    const grown = NOTE.replace("due: 2026-11-01\n---", "due: 2026-11-01\npeople:\n  - Anna\n  - Ben\n---");
    expect(acceptedIn(grown)).toBe(grown.replace("  - Ben\n---", "  - Ben\npriority: high\n---"));
    expect(readFrontmatterPath(acceptedIn(grown)!, ["people"])).toEqual(["Anna", "Ben"]);
    // The note has the property by now: a second entry of one name would make the properties unreadable.
    expect(placeIn(NOTE.replace("due: 2026-11-01\n---", "due: 2026-11-01\npriority: low\n---"))).toMatchObject({ fits: false, property: { key: "priority", added: true } });
    // Properties nobody can read are not added to on a guess.
    expect(placeIn(NOTE.replace("status: open", "status: [open"))).toMatchObject({ fits: false });
  });

  it("makes the first property of a note its properties block — or one more entry, once the note has properties", () => {
    const bare = "# Plan\n\nText\n";
    const first = suggested(bare, "status", "open");
    const second = suggested(bare, "owner", "Anna");
    const afterFirst = first.acceptedIn(bare)!;
    expect(afterFirst).toBe("---\nstatus: open\n---\n# Plan\n\nText\n");
    // Proposed as a block of its own; a second block below the first would be a rule, a line of text and another rule.
    expect(second.acceptedIn(afterFirst)).toBe("---\nstatus: open\nowner: Anna\n---\n# Plan\n\nText\n");
    // The same property twice: the second no longer fits.
    expect(suggested(bare, "status", "done").placeIn(afterFirst)).toMatchObject({ fits: false });
    // Text added above the place it was proposed at: a properties block is at the very top, or it is none.
    const above = "Intro.\n\n# Plan\n\nText\n";
    expect(first.acceptedIn(above)).toBe(`---\nstatus: open\n---\n${above}`);
    // In a note with Windows line endings the entry is written with them.
    const windows = "---\r\nstatus: open\r\n---\r\n# Plan\r\n\r\nText\r\n";
    const fromBare = suggested("# Plan\r\n\r\nText\r\n", "owner", "Anna");
    expect(fromBare.acceptedIn(windows)).toBe("---\r\nstatus: open\r\nowner: Anna\r\n---\r\n# Plan\r\n\r\nText\r\n");
  });

  it("leaves a passage a passage: a line in front of a rule drawn in the text, and whatever is found nowhere", () => {
    const withRule = "---\nstatus: open\n---\n# Plan\n\nAbove.\n\n---\n\nBelow.\n";
    const at = withRule.indexOf("---\n\nBelow.");
    const anchor = buildCommentAnchor(withRule, at, at, mintAnchorMarkerId(withRule));
    // By its words alone it reads like a new property; where it is says that it is text.
    expect(proposedPropertyOf(anchor, "priority: high\n")).toMatchObject({ key: "priority", form: "insert" });
    expect(placeProposedProperty(withRule, anchor, "priority: high\n", { from: at, to: at })).toBeNull();
    expect(placeProposedProperty(withRule, anchor, "priority: high\n", null)).toBeNull();
    const text = buildCommentAnchor(withRule, withRule.indexOf("Above"), withRule.indexOf("Above") + 5, mintAnchorMarkerId(withRule));
    expect(placeProposedProperty(withRule, text, "Over", { from: withRule.indexOf("Above"), to: withRule.indexOf("Above") + 5 })).toBeNull();
  });
});

describe("deciding about suggestions that propose properties (planCommentDecision)", () => {
  let ids = 0;
  /** A suggestion as the store holds it, made against `base`: a property (`key`), or a passage (`find`). */
  const record = (base: string, change: { key: string; value: PropertyValue | null } | { find: string; replace: string }): WorkspaceCommentRecord => {
    let from: number;
    let to: number;
    let replacement: string;
    let hint: { kind: "property"; key: string } | undefined;
    if ("key" in change) {
      const plan = planned(base, change.key, change.value);
      ({ from, to, replacement } = plan.block!);
      hint = plan.hinted ? { kind: "property", key: change.key } : undefined;
    } else {
      from = base.indexOf(change.find);
      to = from + change.find.length;
      replacement = change.replace;
    }
    return {
      commentId: `c${++ids}`,
      targetObjectId: "note.md",
      parentCommentId: null,
      authorMemberId: "plainva-ai/m-1",
      authorDeviceId: "desktop",
      body: "",
      createdAt: "2026-10-07T10:00:00.000Z",
      anchor: buildCommentAnchor(base, from, to, mintAnchorMarkerId(base), hint),
      suggestion: { replacement, appliedAt: null, appliedBy: null, declinedAt: null },
      resolvedAt: null,
      resolvedCommentId: null,
    };
  };
  const accept = (now: string, ...records: WorkspaceCommentRecord[]) => planCommentDecision("note.md", now, records, "applied").text!.intended;

  it("accepts a passage, a value and a new property in one decision — each where it belongs", () => {
    const text = accept(NOTE, record(NOTE, { find: "is also a sentence", replace: "was once a sentence" }), record(NOTE, { key: "status", value: "done" }), record(NOTE, { key: "priority", value: "high" }));
    expect(text).toBe(["---", "status: done", "tags:", "  - roof", "  - house", "due: 2026-11-01", "priority: high", "---", "# Plan", "", "status: open was once a sentence here.", ""].join("\n"));
  });

  it("finds each suggestion once, in the note as it stood — the others of the decision may change every word around it", () => {
    // A short note: the passage and the value together change both sides of the place the new property was proposed
    // at. Looked for again in the half-written note, it would be found nowhere.
    const brief = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nA short brief.\n";
    const text = accept(brief, record(brief, { find: "short", replace: "very short" }), record(brief, { key: "stage", value: "sent" }), record(brief, { key: "effort", value: 3 }));
    expect(text).toBe("---\nstage: sent\nowner: Anna\neffort: 3\n---\n# Brief\n\nA very short brief.\n");
    // The same holds when a value is removed next to it.
    expect(accept(brief, record(brief, { key: "owner", value: null }), record(brief, { key: "effort", value: 3 }), record(brief, { find: "# Brief", replace: "# The brief" }))).toBe(
      "---\nstage: open\neffort: 3\n---\n# The brief\n\nA short brief.\n",
    );
  });

  it("writes two new properties one after the other, in the order they were handed in", () => {
    const text = accept(NOTE, record(NOTE, { key: "priority", value: "high" }), record(NOTE, { key: "owner", value: "Anna" }));
    expect(text).toBe(NOTE.replace("due: 2026-11-01\n---", "due: 2026-11-01\npriority: high\nowner: Anna\n---"));
  });

  it("makes one properties block of two first properties", () => {
    const bare = "# Plan\n\nText\n";
    expect(accept(bare, record(bare, { key: "status", value: "open" }), record(bare, { key: "owner", value: "Anna" }))).toBe("---\nstatus: open\nowner: Anna\n---\n# Plan\n\nText\n");
    // Accepted one at a time, with the first already in the note, the second ends up in the same block.
    const second = record(bare, { key: "owner", value: "Anna" });
    expect(accept(accept(bare, record(bare, { key: "status", value: "open" })), second)).toBe("---\nstatus: open\nowner: Anna\n---\n# Plan\n\nText\n");
  });

  it("refuses two values for one property, and a value whose entry is gone — before anything is written", () => {
    expect(() => accept(NOTE, record(NOTE, { key: "status", value: "done" }), record(NOTE, { key: "status", value: "waiting" }))).toThrow("comment-suggestion-overlap");
    expect(() => accept(NOTE, record(NOTE, { key: "priority", value: "high" }), record(NOTE, { key: "priority", value: "low" }))).toThrow("comment-suggestion-overlap");
    // The value changed since: the sentence in the text that still reads "status: open" is not the property.
    const changed = NOTE.replace("---\nstatus: open", "---\nstatus: waiting");
    expect(() => accept(changed, record(NOTE, { key: "status", value: "done" }))).toThrow("comment-suggestion-orphan");
    // The note has the property by now.
    expect(() => accept(NOTE.replace("due: 2026-11-01\n---", "due: 2026-11-01\npriority: low\n---"), record(NOTE, { key: "priority", value: "high" }))).toThrow("comment-suggestion-orphan");
  });

  it("writes nothing when a property is declined", () => {
    const declined = planCommentDecision("note.md", NOTE, [record(NOTE, { key: "status", value: "done" })], "declined");
    expect(declined.text).toBeNull();
    expect(declined.kind).toBe("decline");
  });
});
