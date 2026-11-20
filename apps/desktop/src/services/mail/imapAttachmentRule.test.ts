import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMessage } from "@plainva/ui/mail";

/**
 * ONE rule of what is a file of an IMAP message, on both shells (Fehlerliste
 * 0.9.0 C6; parity catalog entry `mail-attachment-list`, gone).
 *
 * The list of a message's files is what the reader offers to open and save
 * and what a forward carries. The desktop's parser (mail_imap.rs) listed every
 * part that is not the text — an embedded picture without a name, the logo of
 * a signature, the calendar of an invitation —, the phone's (net/mime.ts) only
 * parts with a file name or attached as one. The same mail had more files on
 * the desktop than on the phone. The rule is the desktop's (the coordination's
 * decision of 2026-11-16): the reader does not show a `cid:` picture in place,
 * so no file of a message may disappear from its list.
 *
 * The example messages are one file, read here and in mail_imap.rs
 * (`one_rule_of_what_is_a_file`), so both parsers are held to the same.
 */

interface RuleCase {
  name: string;
  raw: string;
  files: Array<{ name: string; mime: string }>;
}

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../packages/ui/src/mail/net/attachmentRule.fixtures.json", import.meta.url)), "utf8")) as { cases: RuleCase[] };

describe("what is a file of a message, on the phone's parser", () => {
  it("has its example messages", () => {
    expect(fixtures.cases.length).toBeGreaterThan(8);
  });

  for (const example of fixtures.cases) {
    it(example.name, () => {
      const parsed = parseMessage(example.raw);
      expect(parsed.attachments.map(({ name, mime }) => ({ name, mime }))).toEqual(example.files);
      // Each listed file has its bytes: it opens, saves and goes along with a forward.
      for (const file of parsed.attachments) {
        const part = parsed.parts.find((p) => p.index === file.index);
        expect(part?.bytes, file.name).toBeInstanceOf(Uint8Array);
        expect(file.size).toBe(part!.bytes!.length);
      }
    });
  }

  it("still reads the text and the HTML of a message whose picture is a file", () => {
    const photo = parseMessage(fixtures.cases[0].raw);
    expect(photo.text).toBe("Look:");
    expect(photo.html).toContain("cid:4A1B@example.com");
    const footer = parseMessage(fixtures.cases.find((c) => c.name.startsWith("a footer"))!.raw);
    expect(footer.html).toBe("<p>News</p>");
  });
});
