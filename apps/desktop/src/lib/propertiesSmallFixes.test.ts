import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  boundedInlineSyntax,
  finalizeTemplate,
  inLineEndsOf,
  lineDirections,
  markdownToHtml,
  markdownToPlainText,
  propertyNameTaken,
  replaceCheckboxWithLink,
  resolveTemplate,
  templateKeyNotesOutside,
  textDirectionOf,
  withColumnValues,
  withoutTemplateKeys,
  withVaultContext,
  wikiLinkInlineSyntax,
} from "@plainva/ui";

/** Small fixes of the bug-clearing plan, package P13b — the shared helpers both shells call. */

describe("a property's new name another property has (3.144 no. 10)", () => {
  it("is taken in any casing, and a property's own name in another casing is not", () => {
    expect(propertyNameTaken(["owner", "Status"], "owner", "status")).toBe(true);
    expect(propertyNameTaken(["owner", "Status"], "owner", "Status")).toBe(true);
    expect(propertyNameTaken(["owner", "Status"], "owner", "Owner")).toBe(false);
    expect(propertyNameTaken(["owner"], "owner", "person")).toBe(false);
  });
});

describe("the database's loops find a value under the key the note carries (3.144 no. 3)", () => {
  it("converts `Frist:` under the column `frist`, under its own key", () => {
    const convert = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00` : undefined);
    expect(withColumnValues({ Frist: "2026-11-02", other: 1 }, ["frist"], convert)).toEqual({ Frist: "2026-11-02T12:00", other: 1 });
    expect(withColumnValues({ Frist: "2026-11-02T08:00" }, ["frist"], () => undefined)).toBeNull();
  });

  it("fills an empty `Prio:` under the column `prio` and adds no second key", () => {
    const fill = (value: unknown) => (value === undefined || value === null || value === "" ? "" : undefined);
    expect(withColumnValues({ Prio: null }, ["prio"], fill)).toEqual({ Prio: "" });
    expect(withColumnValues({ title: "x" }, ["prio"], fill)).toEqual({ title: "x", prio: "" });
    expect(withColumnValues({ Prio: "high" }, ["prio"], fill)).toBeNull();
  });
});

describe("a template's answers take the line ends of the text (3.143 no. 3)", () => {
  it("turns `\\r\\n` from the clipboard into the text's `\\n`, and into `\\r\\n` in a text of `\\r\\n`", () => {
    expect(inLineEndsOf("a\nb", "x\r\ny\rz")).toBe("x\ny\nz");
    expect(inLineEndsOf("a\r\nb", "x\ny")).toBe("x\r\ny");
    const resolved = resolveTemplate("Note: {{prompt:Text}}\n", { now: new Date(2026, 10, 2), title: "T" }, "interactive");
    expect(finalizeTemplate(resolved.text, { Text: "line 1\r\nline 2" }).text).toBe("Note: line 1\nline 2\n");
  });
});

describe("`{{daily}}` with daily notes nobody could read (3.143 no. 5)", () => {
  it("stays text instead of linking into the vault's root", async () => {
    const ctx = await withVaultContext({ now: new Date(2026, 10, 2), title: "T" }, { name: "V", dailyFolder: "", dailyFormat: "", dailyUnknown: true });
    expect(ctx.dailyPath).toBeUndefined();
    expect(resolveTemplate("{{daily}}", ctx, "headless").text).toBe("{{daily}}");
    const known = await withVaultContext({ now: new Date(2026, 10, 2), title: "T" }, { name: "V", dailyFolder: "Journal", dailyFormat: "", dailyUnknown: undefined });
    expect(known.dailyPath?.(0)).toBe("Journal/2026-11-02");
  });
});

describe("the fence readers of mail, copy and writing direction read the one rule (3.159 no. 4, E16)", () => {
  const CALLOUT = "> [!note] Code\n> ```\n> **not bold** [[not a link]]\n> ```\n> after";

  it("markdownToHtml: a fence in a callout is code, without the quote's markers", () => {
    const html = markdownToHtml(CALLOUT);
    expect(html).toContain("<pre><code>**not bold** [[not a link]]</code></pre>");
    expect(html).not.toContain("<strong>not bold</strong>");
  });

  it("markdownToPlainText: the code of a fence in a callout comes out verbatim", () => {
    expect(markdownToPlainText(CALLOUT)).toContain("**not bold** [[not a link]]");
  });

  it("a backtick fence with a backtick in its info string is no fence, and a shallower line ends a quoted fence", () => {
    expect(markdownToHtml("```x```\ntext")).not.toContain("<pre>");
    expect(markdownToPlainText("> ```\n> code\nplain **bold**")).toContain("plain bold");
  });

  it("the writing direction: a line behind a quoted fence that ended with its quote is text again", () => {
    // The fence opened in the quote ends with it; the Hebrew line after it is a paragraph of its own.
    const dirs = lineDirections("> ```\n> code\n\nשלום עולם");
    expect(dirs[3]).toBe("rtl");
    expect(textDirectionOf("```\nשלום\n```\nhello")).toBe("ltr");
    expect(textDirectionOf("- ```\n  שלום\n  ```\nhello")).toBe("ltr");
  });
});

describe("the editor reads a wiki link's name as written (3.133 no. 2, E9)", () => {
  const tree = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [boundedInlineSyntax, wikiLinkInlineSyntax] })] });
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: (node) => { names.push(`${node.name}:${doc.slice(node.from, node.to)}`); } });
    return names;
  };

  it("finds no emphasis in a name, and keeps it in an alias", () => {
    expect(tree("[[__init__]] and [[_private_]]").filter((n) => /Emphasis/.test(n))).toEqual([]);
    expect(tree("[[__init__]]")).toContain("WikiLink:[[__init__]]");
    expect(tree("![[a_b_.png]]")).toContain("WikiLink:![[a_b_.png]]");
    expect(tree("[[Note|*the* alias]]")).toContain("Emphasis:*the*");
    // Two links whose underscores paired across both are two links.
    expect(tree("[[_x]] and [[y_]]").filter((n) => n.startsWith("WikiLink:"))).toEqual(["WikiLink:[[_x]]", "WikiLink:[[y_]]"]);
  });

  it("opens none behind a backslash, in a code span, or without its `]]` on the line", () => {
    expect(tree("\\[[x]]").some((n) => n.startsWith("WikiLink"))).toBe(false);
    expect(tree("`[[x]]`").some((n) => n.startsWith("WikiLink"))).toBe(false);
    expect(tree("[[x\ny]]").some((n) => n.startsWith("WikiLink"))).toBe(false);
  });
});

describe("the promotion of a task in a note of carriage returns (3.96, 3.142)", () => {
  it("replaces the box's own line and keeps the rest of the note", () => {
    const result = replaceCheckboxWithLink("- [ ] a\r- [ ] b\rtail", 1, "Tasks/b");
    expect(result.content).toBe("- [ ] a\r- [[Tasks/b]]\rtail");
  });
});

describe("keys a note took over from a template (3.136 no. 1, E2)", () => {
  it("lists the notes outside the template folder", () => {
    const notes = [
      { path: "Templates/Daily.md", title: "Daily", hidesTasks: true, templateFor: false },
      { path: "templates/x.md", title: "x", hidesTasks: true, templateFor: false },
      { path: "Journal/2026-11-02.md", title: "2026-11-02", hidesTasks: true, templateFor: true },
    ];
    expect(templateKeyNotesOutside(notes, "Templates/").map((n) => n.path)).toEqual(["Journal/2026-11-02.md"]);
    expect(templateKeyNotesOutside(notes, "").length).toBe(3);
  });

  it("takes out both keys where they stand, and nothing else", () => {
    const note = "---\ntitle: Day\nplainva:\n  tasks: false\n  templateFor: [\"[[Tasks.base]]\"]\n  icon: star\n---\n- [ ] a\n";
    expect(withoutTemplateKeys(note)).toBe("---\ntitle: Day\nplainva:\n  icon: star\n---\n- [ ] a\n");
    expect(withoutTemplateKeys("---\nplainva:\n  tasks: false\n---\nx")).toBe("x");
    // A note that shows its tasks keeps `plainva.tasks: true` — it is no template's key.
    expect(withoutTemplateKeys("---\nplainva:\n  tasks: true\n---\nx")).toBe("---\nplainva:\n  tasks: true\n---\nx");
  });
});

describe("the cards count checkboxes as the scan does (3.96, review)", () => {
  it("ends a line at a carriage return of its own", async () => {
    const { listTaskLines } = await import("@plainva/ui");
    const { scanTasks } = await import("@plainva/core");
    const note = "- [ ] a\r- [ ] b\n- [ ] c";
    expect(listTaskLines(note).map((task) => [task.ordinal, task.text])).toEqual([[0, "a"], [1, "b"], [2, "c"]]);
    expect(scanTasks(note).map((task) => [task.ordinal, task.text])).toEqual([[0, "a"], [1, "b"], [2, "c"]]);
  });
});
