import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The words of the system's assistant (AI harness P4.7), checked against the
 * Swift that uses them.
 *
 * What Siri and Shortcuts show and understand of Plainva is not in the locale
 * files: an App Intent runs natively and takes its texts from the app bundle.
 * So there are two tables beside the Swift code, and nothing ties them to it
 * but a string — a title that is renamed in `PlainvaIntents.swift` and not in
 * the table simply appears in English, in every language, without a failing
 * build. This guard is that tie:
 *
 *  - every text the intents name exists in `PlainvaIntents.xcstrings`, in all
 *    ten languages of the app, with the same placeholders; and the table
 *    holds nothing the code no longer names;
 *  - every phrase of `PlainvaShortcuts` exists in each language's
 *    `AppShortcuts.strings`, names the app there, and keeps its parameter.
 *
 * The phrases are `.strings` files and not a string catalog on purpose: the
 * build refuses `AppShortcuts.xcstrings` below iOS 17 (found by the iOS
 * workflow on 2026-10-07), and the app's deployment target is lower. The last
 * test holds that reason, so that the form changes when the target does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const app = join(repo, "apps", "mobile", "ios", "App", "App");
const swift = readFileSync(join(app, "PlainvaIntents.swift"), "utf8");
const project = readFileSync(join(repo, "apps", "mobile", "ios", "App", "App.xcodeproj", "project.pbxproj"), "utf8");
const LANGUAGES = readdirSync(join(repo, "packages", "ui", "src", "locales"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

/** A Swift string literal as the tables spell it: `\(\.$note)` and `\(.applicationName)` become `${…}`. */
const asKey = (literal: string) =>
  literal
    .replace(/\\\(\\\.\$(\w+)\)/g, (_match, name: string) => `\${${name}}`)
    .replace(/\\\(\.(\w+)\)/g, (_match, name: string) => `\${${name}}`)
    .replace(/\\"/g, '"');

const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;
const placeholders = (text: string) => [...text.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]).sort();

/** The texts the intents take from the table `PlainvaIntents`. */
function intentTexts(): string[] {
  const found = new Set<string>();
  for (const pattern of [
    new RegExp(String.raw`LocalizedStringResource\(${LITERAL}, table: "PlainvaIntents"\)`, "g"),
    new RegExp(String.raw`\bwords\(${LITERAL}\)`, "g"),
    new RegExp(String.raw`Summary\(${LITERAL}, table: "PlainvaIntents"\)`, "g"),
  ]) {
    for (const match of swift.matchAll(pattern)) found.add(asKey(match[1]!));
  }
  return [...found];
}

/** The phrases of the App Shortcuts: every literal inside a `phrases: [ … ]`. */
function shortcutPhrases(): string[] {
  const found: string[] = [];
  for (const block of swift.matchAll(/phrases:\s*\[([\s\S]*?)\]/g)) {
    for (const literal of block[1]!.matchAll(new RegExp(LITERAL, "g"))) found.push(asKey(literal[1]!));
  }
  return found;
}

/** A `.strings` file as a map; every line that is not a pair, a comment or empty is a problem. */
function readStrings(file: string): { pairs: Map<string, string>; problems: string[] } {
  const pairs = new Map<string, string>();
  const problems: string[] = [];
  const unescape = (text: string) => text.replace(/\\(["\\])/g, "$1");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || /^\/\*.*\*\/$/.test(line.trim())) continue;
    const pair = new RegExp(`^${LITERAL} = ${LITERAL};$`).exec(line);
    if (!pair) problems.push(`not a pair: ${line}`);
    else if (pairs.has(unescape(pair[1]!))) problems.push(`twice: ${pair[1]}`);
    else pairs.set(unescape(pair[1]!), unescape(pair[2]!));
  }
  return { pairs, problems };
}

describe("the intents' texts (PlainvaIntents.xcstrings)", () => {
  const catalog = JSON.parse(readFileSync(join(app, "PlainvaIntents.xcstrings"), "utf8")) as {
    sourceLanguage: string;
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { state?: string; value?: string } }> }>;
  };
  const used = intentTexts();

  it("finds what the Swift code names", () => {
    // A reader that finds nothing would pass everything below.
    expect(used.length).toBeGreaterThan(20);
    expect(used).toContain("Open Note");
    expect(used).toContain("Open ${note}");
    expect(used).toContain("Noted. Plainva writes it into the journal when it is next opened.");
  });

  it("holds every text the code names, and none it no longer names", () => {
    expect(catalog.sourceLanguage).toBe("en");
    expect(Object.keys(catalog.strings).sort()).toEqual([...used].sort());
  });

  it("says each of them in all ten languages, with the same placeholders", () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(catalog.strings)) {
      expect(Object.keys(entry.localizations ?? {}).sort(), key).toEqual(LANGUAGES);
      for (const language of LANGUAGES) {
        const unit = entry.localizations?.[language]?.stringUnit;
        if (unit?.state !== "translated" || !unit.value?.trim()) problems.push(`${language}: no text for "${key}"`);
        else if (placeholders(unit.value).join() !== placeholders(key).join()) problems.push(`${language}: other placeholders in "${key}"`);
        else if (language === "en" && unit.value !== key) problems.push(`en: "${key}" is not its own text`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("the spoken phrases (AppShortcuts.strings)", () => {
  const phrases = shortcutPhrases();

  it("finds the phrases of the four shortcuts, each naming the app", () => {
    expect(phrases).toHaveLength(8);
    for (const phrase of phrases) expect(phrase, phrase).toContain("${applicationName}");
    // One of them carries the note: the system fills it from the list of titles.
    expect(phrases.filter((phrase) => phrase.includes("${note}"))).toEqual(["Open ${note} in ${applicationName}"]);
  });

  it("has every phrase in every language — naming the app, keeping the note, and nothing beside them", () => {
    const problems: string[] = [];
    for (const language of LANGUAGES) {
      const file = join(app, `${language}.lproj`, "AppShortcuts.strings");
      expect(existsSync(file), `${language}.lproj/AppShortcuts.strings`).toBe(true);
      const table = readStrings(file);
      problems.push(...table.problems.map((problem) => `${language}: ${problem}`));
      expect([...table.pairs.keys()].sort(), language).toEqual([...phrases].sort());
      for (const [key, value] of table.pairs) {
        if (!value.trim()) problems.push(`${language}: no text for "${key}"`);
        else if (placeholders(value).join() !== placeholders(key).join()) problems.push(`${language}: other placeholders in "${key}"`);
        else if (language === "en" && value !== key) problems.push(`en: "${key}" is not its own text`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("is part of the app in every language", () => {
    for (const language of LANGUAGES) {
      expect(project, language).toContain(`${language}.lproj/AppShortcuts.strings`);
      // A region the project does not know is a file the build may leave out.
      expect(project, `knownRegions: ${language}`).toMatch(new RegExp(`knownRegions = \\([^)]*\\b"?${language}"?,`));
    }
    expect(project).toContain("AppShortcuts.strings in Resources");
  });

  it("stays a .strings table for as long as the app runs below iOS 17", () => {
    const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = (\d+)(?:\.\d+)*;/g)].map((match) => Number(match[1]));
    expect(targets.length).toBeGreaterThan(0);
    const lowest = Math.min(...targets);
    // The build refuses the string-catalog form below iOS 17. Once the target is there, either form is allowed.
    if (lowest < 17) expect(existsSync(join(app, "AppShortcuts.xcstrings")), "AppShortcuts.xcstrings needs iOS 17").toBe(false);
  });
});
