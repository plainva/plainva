import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import { errorText, rewriteNoteProperties, writableProperties, writeNoteProperty, type PropertyWriteAdapter } from "@plainva/ui";
import { updateFrontmatterString } from "@plainva/core";
import { REPO } from "../test-sourceTree";

/**
 * A note whose properties cannot be written is left alone, byte for byte — and
 * "could not be read" is not "has none" (finding 2026-10-09).
 *
 * The property writers of both shells work on the whole set: read the note's
 * properties, change one, hand all of them back; a key the new set no longer
 * names is removed. A block the reader cannot read is therefore refused
 * instead of rewritten: YAML that cannot be parsed, and YAML that is no map.
 *
 * A third kind was refused until 2026-10-22: a map with a value the reader's
 * schema rejected — an empty `tags:`, a year among the tags, a number as
 * `title`. Before 2026-10-11 it was WRITTEN, as an empty set, and every
 * property but the one being set left the note. The reader takes every value
 * now (ADR 0009, addendum 2026-10-22), and such a note is written like any
 * other: the one property changes, and not another byte of the note.
 *
 * Only the file store is faked. Parser, reader and writer run for real.
 */

const LIST = "---\n- a\n- list\n---\nText\n";
const UNPARSEABLE = "---\ntitle: [unclosed\nowner: Anna\n---\nText\n";
const PROSE = "---\nA line between two rules\n---\nText\n";
const EMPTY_TAGS = "---\ntags:\nstatus: open\nowner: Anna\n---\nText\n";
const YEAR_AMONG_TAGS = "---\ntags:\n  - 2024\n  - journal\nstatus: open\nowner: Anna\n---\nText\n";
const NUMBER_AS_TITLE = "---\ntitle: 2024\nstatus: open\nowner: Anna\n---\nText\n";
const DATE_AS_TIMESTAMP = "---\ntype: Referenz\ntimestamp: 2026-06-22\nstatus: open\naliases: [ Plainva Domains ]\n---\nText\n";
const PLACEHOLDER = "---\ntags:\n  - typ/template\naliases:\n  - {{title}}\nstatus: open\n---\n# {{title}}\n";
const READABLE = "---\ntitle: Report\nstatus: open\nowner: Anna\n---\nText\n";
/** What a whole-set write used to give back in another form (Sammelplan § 3.70): none of it may move. */
const FORMS = "---\ntitle: Report # the title\ntags: a, b\naliases: [x, y] # two names\n2024: goals\nplz: 01067\nstatus: open\nowner:    Anna\n---\nText\n";

const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"] as const;

function vault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  const adapter: PropertyWriteAdapter = {
    async readTextFile(path) {
      const text = store.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    async writeTextFile(path, content) {
      writes.push(path);
      store.set(path, content);
    },
  };
  return { store, writes, adapter };
}

async function refusalOf(note: string): Promise<unknown> {
  const { adapter } = vault({ "n.md": note });
  return writeNoteProperty(adapter, "n.md", "status", "done").then(
    () => { throw new Error("the note was written"); },
    (error: unknown) => error,
  );
}

/** The note with the one line of `status` changed — and nothing else. */
const withStatus = (note: string, line: string) => {
  expect(note.split("status: open").length, "the note holds status: open once").toBe(2);
  return note.replace("status: open\n", line);
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("writeNoteProperty: a block that cannot be written to", () => {
  it.each([
    ["a YAML list", LIST],
    ["YAML that cannot be parsed", UNPARSEABLE],
    ["text between two rules", PROSE],
  ])("refuses %s and leaves the note byte for byte", async (_label, note) => {
    const { adapter, store, writes } = vault({ "n.md": note });

    await expect(writeNoteProperty(adapter, "n.md", "status", "done")).rejects.toThrow(/^Frontmatter /);

    expect(writes).toEqual([]);
    expect(store.get("n.md")).toBe(note);
  });

  it("a note without a block has no properties — that is a set to start from", () => {
    expect(writableProperties("Text\n")).toEqual({});
    expect(writableProperties("---\n---\nText\n")).toEqual({});
  });
});

describe("writeNoteProperty: a value the reader's schema refused the whole block over", () => {
  it.each([
    ["an empty tags key", EMPTY_TAGS],
    ["a year among the tags", YEAR_AMONG_TAGS],
    ["a number as title", NUMBER_AS_TITLE],
    ["a timestamp that is a date", DATE_AS_TIMESTAMP],
    ["a template's placeholder under aliases", PLACEHOLDER],
  ])("%s: the one property changes, and not another byte of the note", async (_label, note) => {
    const { adapter, store } = vault({ "n.md": note });

    await writeNoteProperty(adapter, "n.md", "status", "done");
    expect(store.get("n.md")).toBe(withStatus(note, "status: done\n"));

    await writeNoteProperty(adapter, "n.md", "status", "");
    expect(store.get("n.md")).toBe(withStatus(note, ""));
  });

  it("the reader names every key of such a note, so a whole set handed back keeps them — as they stand", () => {
    expect(writableProperties(EMPTY_TAGS)).toEqual({ tags: [], status: "open", owner: "Anna" });
    expect(writableProperties(NUMBER_AS_TITLE)).toEqual({ title: "2024", status: "open", owner: "Anna" });
    // Handed back, a reading is not written: `tags:` stays empty and is not
    // written as `tags: []`, the title stays the number it is.
    expect(updateFrontmatterString(EMPTY_TAGS, { ...writableProperties(EMPTY_TAGS), status: "done" })).toBe(withStatus(EMPTY_TAGS, "status: done\n"));
    expect(updateFrontmatterString(NUMBER_AS_TITLE, { ...writableProperties(NUMBER_AS_TITLE), status: "done" })).toBe(withStatus(NUMBER_AS_TITLE, "status: done\n"));
    // What the whole-set writer did with the set before it asked: the reader
    // failed on `tags:`, the set was `{ status }`, and `owner` and `tags` left the note.
    expect(updateFrontmatterString(EMPTY_TAGS, { status: "done" })).toBe("---\nstatus: done\n---\nText\n");
  });

  it("comments, a bracket list, a text with commas, a number with a leading zero and a key that is a number stay as they are", async () => {
    const { adapter, store } = vault({ "n.md": FORMS });

    await writeNoteProperty(adapter, "n.md", "status", "done");
    expect(store.get("n.md")).toBe(withStatus(FORMS, "status: done\n"));
  });

  it("still writes a note it could always read, and only the one property", async () => {
    const { adapter, store } = vault({ "n.md": READABLE });

    await writeNoteProperty(adapter, "n.md", "status", "done");

    expect(store.get("n.md")).toBe("---\ntitle: Report\nstatus: done\nowner: Anna\n---\nText\n");
  });
});

describe("a refused block, said to the user", () => {
  it("says a block that is no YAML map in words, whoever refused it", async () => {
    const sentence = i18n.t("inputRejected.propertiesBlock");
    expect(sentence).toMatch(/cannot be read as properties/);
    expect(errorText(await refusalOf(LIST))).toBe(sentence);
    expect(errorText(await refusalOf(PROSE))).toBe(sentence);
    expect(errorText(await refusalOf(UNPARSEABLE))).toBe(sentence);
    // The core's writers raise the same refusals with their own text — the
    // surgical helpers and `updateFrontmatterString` — and are read alike.
    for (const note of [LIST, PROSE, UNPARSEABLE]) {
      let raised: unknown;
      try { updateFrontmatterString(note, { status: "done" }); } catch (error) { raised = error; }
      expect(errorText(raised)).toBe(sentence);
    }
  });

  it("never carries the note's own text: the YAML parser quotes the line it failed on", () => {
    let raised: unknown;
    try { updateFrontmatterString(UNPARSEABLE, { status: "done" }); } catch (error) { raised = error; }
    // The raw message does — that is what a toast used to show and the
    // diagnostics trail used to keep.
    expect((raised as Error).message).toContain("unclosed");
    expect(errorText(raised)).not.toContain("unclosed");
    // Across a window boundary the error arrives as its text.
    expect(errorText((raised as Error).message)).not.toContain("unclosed");
  });

  it("speaks the user's language", async () => {
    await i18n.changeLanguage("de");
    expect(errorText(await refusalOf(LIST))).toMatch(/lässt sich nicht als Eigenschaften lesen/);
  });

  it("has the sentence in every language — and no longer the one for a single value, which nothing raises", () => {
    for (const lang of LANGS) {
      const bundle = JSON.parse(readFileSync(join(REPO, "packages", "ui", "src", "locales", `${lang}.json`), "utf8")) as {
        inputRejected?: Record<string, string>;
      };
      expect(bundle.inputRejected?.propertiesBlock, `${lang} lacks inputRejected.propertiesBlock`).toBeTruthy();
      expect(bundle.inputRejected?.propertyValue, `${lang} still has inputRejected.propertyValue`).toBeUndefined();
    }
  });
});

describe("rewriteNoteProperties", () => {
  const fill = (props: Record<string, unknown>) => ("due" in props ? null : { ...props, due: "" });

  it("goes on past the notes it cannot write and says which those were", async () => {
    const { adapter, store, writes } = vault({
      "ok.md": READABLE,
      "list.md": LIST,
      "tags.md": EMPTY_TAGS,
      "has-it.md": "---\ndue: 2026-10-09\n---\nText\n",
    });

    const result = await rewriteNoteProperties(adapter, ["ok.md", "list.md", "tags.md", "gone.md", "has-it.md"], fill);

    expect(result.written).toEqual(["ok.md", "tags.md"]);
    expect(result.failed.map((f) => f.path)).toEqual(["list.md", "gone.md"]);
    expect(result.failed[1].message).toContain("no such file");
    // Written is what the change asked for — also in the note with the empty
    // `tags:`, which was refused until the reader took it —, …
    expect(store.get("ok.md")).toBe("---\ntitle: Report\nstatus: open\nowner: Anna\ndue: \"\"\n---\nText\n");
    expect(store.get("tags.md")).toBe("---\ntags:\nstatus: open\nowner: Anna\ndue: \"\"\n---\nText\n");
    // … a note the change leaves alone is not touched, and neither is one
    // that was refused.
    expect(writes).toEqual(["ok.md", "tags.md"]);
    expect(store.get("list.md")).toBe(LIST);
    expect(store.get("has-it.md")).toBe("---\ndue: 2026-10-09\n---\nText\n");
  });

  it("no notes, nothing to report", async () => {
    const { adapter } = vault({});
    expect(await rewriteNoteProperties(adapter, [], fill)).toEqual({ written: [], failed: [] });
  });
});
