import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings: { defaultNoteType?: string | null; dailyNoteType?: string | null } = {};
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => settings }));

import { vaultDefaults } from "./mobileSettingsScope";
import { configuredDailyNoteType, configuredNoteType, dailyNoteTypeOf, noteTypeOf } from "./newNote";

/**
 * The `type` a new note gets on the phone (finding 2026-10-09).
 *
 * The settings "type for new notes" and "type for daily notes" are read in one
 * place, the way the desktop reads them (`getConfiguredNoteType` and its daily
 * twin; `apps/desktop/src/services/newNote.test.ts` holds the same three
 * cases): the name without the blanks around it, and a blank setting is an
 * unset one. The second half of this file keeps it at one place.
 */
describe("the type a new note gets on the phone", () => {
  beforeEach(() => {
    delete settings.defaultNoteType;
    delete settings.dailyNoteType;
  });

  it("is the vault default while nothing is set", () => {
    expect(configuredNoteType()).toBe("Note");
    expect(configuredDailyNoteType()).toBe("Daily Note");
    settings.defaultNoteType = null;
    settings.dailyNoteType = null;
    expect(configuredNoteType()).toBe("Note");
    expect(configuredDailyNoteType()).toBe("Daily Note");
  });

  it("is the name that was set, without the blanks around it", () => {
    settings.defaultNoteType = "  Zettel  ";
    settings.dailyNoteType = "\tTagebuch ";
    expect(configuredNoteType()).toBe("Zettel");
    expect(configuredDailyNoteType()).toBe("Tagebuch");
    // Blanks inside a name belong to it.
    settings.defaultNoteType = "Daily Log";
    expect(configuredNoteType()).toBe("Daily Log");
  });

  it.each(["", " ", "   ", "\t", "\n"])("is the vault default for a blank setting (%j) — never an empty type", (blank) => {
    settings.defaultNoteType = blank;
    settings.dailyNoteType = blank;
    expect(configuredNoteType()).toBe("Note");
    expect(configuredDailyNoteType()).toBe("Daily Note");
  });

  it("follows the setting from one note to the next", () => {
    settings.defaultNoteType = "Zettel";
    expect(configuredNoteType()).toBe("Zettel");
    settings.defaultNoteType = "Idee";
    expect(configuredNoteType()).toBe("Idee");
  });

  it("reads a stored value by the same rule the settings fields save by", () => {
    expect(noteTypeOf("  Zettel ")).toBe("Zettel");
    expect(noteTypeOf("  ")).toBe("Note");
    expect(noteTypeOf(undefined)).toBe("Note");
    expect(dailyNoteTypeOf(" Tagebuch")).toBe("Tagebuch");
    expect(dailyNoteTypeOf("")).toBe("Daily Note");
    // Saving twice changes nothing.
    for (const text of ["  Zettel ", "", "Daily Log"]) expect(noteTypeOf(noteTypeOf(text))).toBe(noteTypeOf(text));
  });
});

/** Every shipped source file of a shell (the phone's unless named), relative to its src/ with `prefix` in front, parsed. */
function shippedSources(SRC = join(process.cwd(), "src"), prefix = ""): ts.SourceFile[] {
  const out: ts.SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        const rel = prefix + path.slice(SRC.length + 1).replace(/\\/g, "/");
        out.push(ts.createSourceFile(rel, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
      }
    }
  };
  walk(SRC);
  return out;
}

/** `file:line` of every node in `file` that `hit` accepts. */
function places(file: ts.SourceFile, hit: (node: ts.Node) => boolean): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (hit(node)) found.push(`${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("one place names the type of a new note", () => {
  const sources = shippedSources();

  /**
   * Where the two settings may be named: the one reader and the settings
   * record (its type, its defaults, its fill-in from the store). The settings
   * sync moves the two through the shared field catalog and names neither.
   */
  const MAY_NAME_THE_SETTINGS = ["services/newNote.ts", "services/mobileSettingsScope.ts"];
  /** The settings fields show and save the stored text: each setting twice there, as the value and as the save.
   *  Since the settings plan of 2026-10-29 the two fields stand on two screens (E9). */
  const FIELD_OF: Record<string, string> = {
    defaultNoteType: "screens/SettingsAreaScreens.tsx",
    dailyNoteType: "screens/JournalAreaScreen.tsx",
  };
  const FIELDS = Object.values(FIELD_OF);
  const SETTINGS = ["defaultNoteType", "dailyNoteType"];
  const namesASetting = (node: ts.Node) =>
    (ts.isIdentifier(node) && SETTINGS.includes(node.text)) ||
    // `settings["defaultNoteType"]` — a string that is used as a key.
    (ts.isStringLiteralLike(node) && SETTINGS.includes(node.text) && ts.isElementAccessExpression(node.parent));

  it("no shipped file reads the settings on its own", () => {
    // Eleven places did, one of them with a fallback of its own; a blank field
    // wrote an empty `type` through the other ten.
    const offenders = sources
      .filter((file) => !MAY_NAME_THE_SETTINGS.includes(file.fileName) && !FIELDS.includes(file.fileName))
      .flatMap((file) => places(file, namesASetting))
      .map((place) => `${place}: ask configuredNoteType() or configuredDailyNoteType() from services/newNote.ts`);
    expect(offenders).toEqual([]);
    for (const name of SETTINGS) {
      const fields = sources.find((file) => file.fileName === FIELD_OF[name])!;
      const named = places(fields, (node) => namesASetting(node) && (node as ts.Identifier).text === name);
      expect(named, `${FIELD_OF[name]} names ${name} for its field's value and save only — anything else asks services/newNote.ts`).toHaveLength(2);
    }
  });

  it("no shipped file names the default type itself", () => {
    // `vaultOps.createNote(vault, folder, "Note")` behind the capture button and
    // `buildNewNoteContent("Note", title)` for a note made from a link: both
    // wrote `Note` whatever the vault's setting said. The names come from the
    // settings' own defaults, not from the reader this test guards.
    const DEFAULTS = [vaultDefaults().defaultNoteType, vaultDefaults().dailyNoteType];
    expect(DEFAULTS).toEqual(["Note", "Daily Note"]);
    const offenders = sources
      .flatMap((file) => places(file, (node) => ts.isStringLiteralLike(node) && DEFAULTS.includes(node.text)))
      .map((place) => `${place}: ask configuredNoteType() or configuredDailyNoteType() from services/newNote.ts`);
    expect(offenders).toEqual([]);
  });

  it("finds what it is looking for", () => {
    const probe = (text: string) => ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
    expect(places(probe("const a = getMobileSettings().defaultNoteType;\nconst b = ms.dailyNoteType;"), namesASetting)).toEqual(["probe.ts:1", "probe.ts:2"]);
    expect(places(probe("const { defaultNoteType } = getMobileSettings();"), namesASetting)).toEqual(["probe.ts:1"]);
    expect(places(probe('const a = getMobileSettings()["defaultNoteType"];'), namesASetting)).toEqual(["probe.ts:1"]);
    // A comment or a sentence that mentions the setting is not a reader.
    expect(places(probe('// defaultNoteType\nconst hint = "defaultNoteType";'), namesASetting)).toEqual([]);
    expect([...MAY_NAME_THE_SETTINGS, ...FIELDS].every((rel) => sources.some((file) => file.fileName === rel))).toBe(true);
  });
});

/**
 * A task note is a new note, on both shells (finding 2026-10-21).
 *
 * The desktop wrote a fixed `Task` for a task made from a mail and from a
 * comment, where its task view and every path of the phone write the vault's
 * type. Read from the shipped sources of both shells: a call of the shared
 * functions that make a task note hands over the type it asked for, never one
 * written into the call.
 */
describe("a task note gets the vault's type, on both shells", () => {
  /** The shared functions that make a task note; each is handed the note's `type`. */
  const MAKES_A_TASK = ["createTaskInDatabase", "prepareTaskNote", "promoteTask"];
  const DESKTOP = "apps/desktop/src/";
  const calleeName = (call: ts.CallExpression) =>
    ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
  const makesATask = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node) && MAKES_A_TASK.includes(calleeName(node));
  /** The `type` a call hands over, where it is written into the call. */
  const typeOf = (call: ts.CallExpression) =>
    call.arguments
      .filter(ts.isObjectLiteralExpression)
      .flatMap((options) => options.properties)
      .filter(ts.isPropertyAssignment)
      .find((property) => (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "noteType")?.initializer;
  const fixedType = (node: ts.Node) => {
    if (!makesATask(node)) return false;
    const type = typeOf(node);
    return !!type && (ts.isStringLiteralLike(type) || ts.isTemplateExpression(type));
  };
  const sources = [...shippedSources(), ...shippedSources(join(process.cwd(), "..", "desktop", "src"), DESKTOP)];

  it("no task note is made with a type of its own", () => {
    const offenders = sources
      .flatMap((file) => places(file, fixedType))
      .map((place) => `${place}: hand over the vault's type (getConfiguredNoteType on the desktop, configuredNoteType() on the phone)`);
    expect(offenders).toEqual([]);
  });

  it("finds what it is looking for", () => {
    const probe = (text: string) => ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
    expect(places(probe('await createTaskInDatabase({ dbPath, noteType: "Task" });'), fixedType)).toEqual(["probe.ts:1"]);
    expect(places(probe("ui.prepareTaskNote({ 'noteType': `Task` });\npromoteTask({ noteType: `${kind}` });"), fixedType)).toEqual(["probe.ts:1", "probe.ts:2"]);
    expect(places(probe("await createTaskInDatabase({ dbPath, noteType: await getConfiguredNoteType(vaultPath) });"), fixedType)).toEqual([]);
    expect(places(probe("createTaskInDatabase({ noteType: configuredNoteType() });\ncreateTaskInDatabase(options);"), fixedType)).toEqual([]);
    // A meeting note keeps a type of its own, on both shells; it is no task.
    expect(places(probe('resolveOrCreateMeetingNote({ noteType: "Meeting" });'), fixedType)).toEqual([]);
    // The mail and the comment, where the desktop wrote `Task`, are among the
    // calls it reads, on both shells.
    const makers = sources.flatMap((file) => places(file, makesATask).map((place) => place.replace(/:\d+$/, "")));
    for (const file of [
      `${DESKTOP}components/mail/MailView.tsx`,
      `${DESKTOP}components/Editor.tsx`,
      `${DESKTOP}components/tasks/TasksView.tsx`,
      "screens/MailMessageScreen.tsx",
      "screens/NoteScreen.tsx",
      "screens/TasksScreen.tsx",
      "components/ShareInbox.tsx",
    ]) {
      expect(makers, `${file} makes a task note`).toContain(file);
    }
  });
});
