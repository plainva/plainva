import { describe, expect, it } from "vitest";
import i18n from "i18next";
import { APP_LANGUAGES } from "@plainva/ui";

/**
 * A value that holds the name of a placeholder lands where its own
 * placeholder stood (Sammelplan § 3.157).
 *
 * i18next up to 26.5.9 put a value in at the first occurrence of its
 * placeholder's TEXT in the half-filled sentence, not where it found it: with
 * the note "{{folder}} notes", "Moved {{name}} to {{folder}}" became "Moved
 * Archive notes to {{folder}}", and a value holding the placeholder of a second
 * occurrence was doubled. Note, folder, account and calendar names come from
 * the person or from outside — Obsidian templates are often called
 * "{{date}} …". 26.5.10 replaces at the place it found (dependency update of
 * 29.10.); this guard holds every sentence of every language to that, so a
 * change of the library or of the app's interpolation settings that brings it
 * back fails here.
 */

const PLACEHOLDER = /\{\{\s*(-\s*)?([^{}]+?)\s*\}\}/g;

function flatten(node: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof node === "string") out.set(prefix, node);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
}

/** The sentence as it should read: each placeholder replaced by its value, at its place. */
function expected(sentence: string, values: Record<string, string>): string {
  return sentence.replace(PLACEHOLDER, (_match, _dash, name: string) => values[name.trim()]);
}

describe("a value that holds a placeholder's name", () => {
  it("lands where its own placeholder stood, in every sentence with two or a repeated placeholder", () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const { code } of APP_LANGUAGES) {
      const t = i18n.getFixedT(code);
      const sentences = new Map<string, string>();
      flatten(i18n.getResourceBundle(code, "translation"), "", sentences);
      for (const [key, sentence] of sentences) {
        const names = [...sentence.matchAll(PLACEHOLDER)].map((m) => m[2].trim());
        // A format (`{{x, number}}`) or a count would need a value of its kind.
        if (names.length < 2 || names.some((n) => n.includes(",") || n === "count")) continue;
        const distinct = [...new Set(names)];
        const values: Record<string, string> = {};
        distinct.forEach((name, i) => {
          const other = distinct[(i + 1) % distinct.length];
          values[name] = `<${name}:{{${other}}}:{{${name}}}>`;
        });
        checked++;
        const got = t(key, { ...values, interpolation: { escapeValue: false } });
        const want = expected(sentence, values);
        if (got !== want) wrong.push(`${code} ${key}: ${got} — expected ${want}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });

  it("the case of the finding", () => {
    i18n.addResource("en", "translation", "__test_moved", "Moved {{name}} to {{folder}}");
    i18n.addResource("en", "translation", "__test_twice", "A setting of {{agent}} — {{agent}}");
    const t = i18n.getFixedT("en");
    expect(t("__test_moved", { name: "{{folder}} notes", folder: "Archive" })).toBe("Moved {{folder}} notes to Archive");
    expect(t("__test_twice", { agent: "My {{agent}} bot" })).toBe("A setting of My {{agent}} bot — My {{agent}} bot");
  });
});
