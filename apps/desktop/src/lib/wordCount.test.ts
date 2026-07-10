import { describe, expect, it } from "vitest";
import { countWords } from "@plainva/ui";

describe("countWords", () => {
  it("counts plain prose", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("Größe naïve café")).toBe(3);
    expect(countWords("1990 hatte 42 Tage")).toBe(4);
  });

  it("ignores bare Markdown structure markers", () => {
    expect(countWords("# Überschrift")).toBe(1);
    expect(countWords("### Tiefe Überschrift")).toBe(2);
    expect(countWords("> Zitat")).toBe(1);
    expect(countWords("- Punkt eins")).toBe(2);
    expect(countWords("* Punkt")).toBe(1);
    expect(countWords("---")).toBe(0);
    expect(countWords("***")).toBe(0);
    expect(countWords("| Spalte | Wert |")).toBe(2);
    expect(countWords("```")).toBe(0);
  });

  it("ignores task checkboxes but counts the task text", () => {
    expect(countWords("- [ ] Aufgabe offen")).toBe(2);
    expect(countWords("- [x] Aufgabe erledigt")).toBe(2);
    expect(countWords("- [X] Aufgabe")).toBe(1);
  });

  it("ignores ordered-list markers only at the start of a line", () => {
    expect(countWords("1. Erster Punkt")).toBe(2);
    expect(countWords("42) Antwort")).toBe(1);
    expect(countWords("  3. eingerückt")).toBe(1);
    // Inside prose a number+dot is real text (years, versions).
    expect(countWords("Das war 2024.")).toBe(3);
    expect(countWords("Kapitel 3. Abschnitt")).toBe(3);
  });

  it("ignores emojis, including ZWJ sequences and flags", () => {
    expect(countWords("👍")).toBe(0);
    expect(countWords("🚀 🔥 ✨")).toBe(0);
    expect(countWords("👨‍👩‍👧‍👦")).toBe(0);
    expect(countWords("🇩🇪 🇫🇷")).toBe(0);
    expect(countWords("Hallo 👍 Welt")).toBe(2);
    // Attached to a word the token still counts once.
    expect(countWords("Hallo👍")).toBe(1);
  });

  it("keeps counting marker-wrapped words and links as words", () => {
    expect(countWords("**fett** und _kursiv_")).toBe(3);
    expect(countWords("==markiert== ~~gestrichen~~")).toBe(2);
    expect(countWords("[[Meine Notiz]]")).toBe(2);
    expect(countWords("[[Note|Alias]]")).toBe(1);
    expect(countWords("[Text](https://example.com)")).toBe(1);
    expect(countWords("https://example.com/ein/pfad")).toBe(1);
    expect(countWords("`inline code`")).toBe(2);
  });

  it("keeps space-less CJK text token-based (documented behaviour)", () => {
    expect(countWords("日本語のテキスト")).toBe(1);
    expect(countWords("中文 文本")).toBe(2);
  });

  it("counts across multiple lines including CRLF", () => {
    expect(countWords("# Kopf\n\nAbsatz mit Text\r\n- [ ] Task\n---\n")).toBe(5);
  });
});
