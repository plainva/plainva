import { describe, expect, it } from "vitest";
import {
  buildNoteLinkUrl,
  chooseLinkVault,
  isNoteLinkAddress,
  NOTE_LINK_MAX_LENGTH,
  noteLinkNameCandidates,
  parseNoteLinkUrl,
  wikiLinkText,
} from "../src/noteLinkUrl.js";

const ch = (code: number) => String.fromCharCode(code);

describe("the note address (ADR 0037)", () => {
  it("round-trips a note, a heading and a block", () => {
    const note = { vault: "Work Notes", path: "Projects/Plan 2026 & more.md" };
    const url = buildNoteLinkUrl(note);
    expect(url).toBe("plainva://open?vault=Work%20Notes&path=Projects%2FPlan%202026%20%26%20more.md");
    expect(parseNoteLinkUrl(url)).toEqual({ ok: true, target: note });
    const heading = { ...note, heading: "Über # uns?" };
    expect(parseNoteLinkUrl(buildNoteLinkUrl(heading))).toEqual({ ok: true, target: heading });
    const block = { ...note, block: "ab12cd" };
    expect(parseNoteLinkUrl(buildNoteLinkUrl(block))).toEqual({ ok: true, target: block });
  });

  it("reads what other tools write: `+` for a space, a slash in the path, a trailing slash, a fragment, an upper-case scheme", () => {
    expect(parseNoteLinkUrl("PLAINVA://Open/?vault=My+Vault&path=a/b.md#x")).toEqual({ ok: true, target: { vault: "My Vault", path: "a/b.md" } });
    expect(parseNoteLinkUrl("plainva://open?path=Note.md")).toEqual({ ok: true, target: { vault: null, path: "Note.md" } });
    expect(parseNoteLinkUrl("plainva://open?path=Note.md&block=%5Eabc")).toMatchObject({ ok: true, target: { block: "abc" } });
  });

  it("accepts the schemes of the development and Labs builds, and copies always with `plainva`", () => {
    expect(parseNoteLinkUrl("plainva-dev://open?path=a.md").ok).toBe(true);
    expect(parseNoteLinkUrl("plainva-labs://open?path=a.md").ok).toBe(true);
    expect(parseNoteLinkUrl("plainva-tlstest://open?path=a.md").ok).toBe(true);
    expect(buildNoteLinkUrl({ vault: null, path: "a.md" }).startsWith("plainva://")).toBe(true);
  });

  it("normalises names to NFC, so a Mac's decomposed spelling is the same note", () => {
    const decomposed = "U" + ch(0x308) + "ber.md";
    const parsed = parseNoteLinkUrl(`plainva://open?vault=${encodeURIComponent("Ka" + ch(0x308) + "se")}&path=${encodeURIComponent(decomposed)}`);
    expect(parsed).toEqual({ ok: true, target: { vault: "Käse", path: "Über.md" } });
  });

  it("refuses other schemes and other actions", () => {
    for (const url of ["https://open?path=a.md", "javascript:alert(1)", "obsidian://open?path=a.md", "file:///etc/passwd", "plainva:open?path=a.md", "", "open?path=a.md"]) {
      expect(parseNoteLinkUrl(url).ok, url).toBe(false);
    }
    expect(parseNoteLinkUrl("plainva://graph")).toEqual({ ok: false, reason: "action" });
    expect(parseNoteLinkUrl("plainva://run?path=a.md")).toEqual({ ok: false, reason: "action" });
    expect(parseNoteLinkUrl("plainva://new?path=a.md")).toEqual({ ok: false, reason: "action" });
    expect(parseNoteLinkUrl(42)).toEqual({ ok: false, reason: "malformed" });
    expect(parseNoteLinkUrl(null)).toEqual({ ok: false, reason: "malformed" });
  });

  it("never leaves the vault: traversal, absolute and drive paths, backslashes, empty segments, internal folders", () => {
    for (const path of ["../x.md", "a/../../x.md", "a/./x.md", "./x.md", "/etc/passwd", "C:/Windows/x.md", "c:x.md", "a\\b.md", "\\\\server\\share\\x.md", "a//b.md", "a/", ".plainva/vault.db", "x/.git/config", ".obsidian/app.json", " ", "a/ /b.md"]) {
      expect(parseNoteLinkUrl(`plainva://open?path=${encodeURIComponent(path)}`), path).toEqual({ ok: false, reason: "path" });
    }
    expect(parseNoteLinkUrl("plainva://open?path=%2E%2E%2Fx.md")).toEqual({ ok: false, reason: "path" });
    expect(parseNoteLinkUrl("plainva://open?vault=a")).toEqual({ ok: false, reason: "path" });
  });

  it("opens only what the tree shows: no segment that starts with a dot, in any spelling (F2 review)", () => {
    const refused = [
      ".notes/a.md", ".Plainva/sync/keyfile.json", ".PLAINVA/sync/settings.json", ".plainva./sync/keyfile.json", ".plainva /sync/keyfile.json",
      ".Obsidian/app.json", ".Git/hooks/pre-commit.sh", ".agent/policy.yml", ".agent/skills/x/SKILL.md", ".pvws/operations/1.json",
      "Projects/.drafts/plan.md", ".hidden.md",
    ];
    for (const path of refused) expect(parseNoteLinkUrl(`plainva://open?path=${encodeURIComponent(path)}`), path).toEqual({ ok: false, reason: "path" });
  });

  it("leaves a name of an unusual shape to the index: a device name or a colon is an ordinary note on most systems", () => {
    for (const path of ["NUL.md", "aux.txt", "Con.md", "Aux/x.md", "Meeting 10:30.md", "Re: offer.md", "Plan~1.md", "COM1.md"]) {
      expect(parseNoteLinkUrl(`plainva://open?path=${encodeURIComponent(path)}`), path).toEqual({ ok: true, target: { vault: null, path } });
    }
  });

  it("refuses invisible and look-alike characters (U+061C, U+200B-D, U+2060-4, U+206A-F, the tag block)", () => {
    for (const code of [0x061c, 0x200b, 0x200c, 0x200d, 0x2060, 0x2063, 0x2064, 0x206a, 0x206f, 0xe0000, 0xe0041, 0xe007f]) {
      const bad = encodeURIComponent("a" + String.fromCodePoint(code) + "b");
      expect(parseNoteLinkUrl(`plainva://open?path=${bad}.md`).ok, `path ${code.toString(16)}`).toBe(false);
      expect(parseNoteLinkUrl(`plainva://open?vault=${bad}&path=a.md`).ok, `vault ${code.toString(16)}`).toBe(false);
      expect(parseNoteLinkUrl(`plainva://open?path=a.md&heading=${bad}`).ok, `heading ${code.toString(16)}`).toBe(false);
    }
    expect(parseNoteLinkUrl(`plainva://open?path=${encodeURIComponent("Caf" + String.fromCodePoint(0xe9) + " " + String.fromCodePoint(0x1f600) + ".md")}`).ok).toBe(true);
  });

  it("keeps working when a later version adds a stable vault id (an unknown parameter does nothing)", () => {
    expect(parseNoteLinkUrl("plainva://open?id=6f1c2e&vault=Work&path=a.md")).toEqual({ ok: true, target: { vault: "Work", path: "a.md" } });
  });

  it("refuses control, separator and bidirectional characters in any value", () => {
    for (const code of [0x00, 0x0a, 0x0d, 0x1b, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x200f, 0xfeff]) {
      const bad = encodeURIComponent("a" + ch(code) + "b");
      expect(parseNoteLinkUrl(`plainva://open?path=${bad}.md`).ok, `path ${code}`).toBe(false);
      expect(parseNoteLinkUrl(`plainva://open?vault=${bad}&path=a.md`).ok, `vault ${code}`).toBe(false);
      expect(parseNoteLinkUrl(`plainva://open?path=a.md&heading=${bad}`).ok, `heading ${code}`).toBe(false);
    }
  });

  it("refuses overlong values and addresses, broken escapes, doubled parameters, two anchors and bad block ids", () => {
    expect(parseNoteLinkUrl(`plainva://open?path=${"a".repeat(NOTE_LINK_MAX_LENGTH)}.md`)).toEqual({ ok: false, reason: "length" });
    expect(parseNoteLinkUrl(`plainva://open?path=${"a/".repeat(600)}x.md`)).toEqual({ ok: false, reason: "path" });
    expect(parseNoteLinkUrl(`plainva://open?vault=${"v".repeat(256)}&path=a.md`)).toEqual({ ok: false, reason: "vault" });
    expect(parseNoteLinkUrl(`plainva://open?path=a.md&heading=${"h".repeat(513)}`)).toEqual({ ok: false, reason: "anchor" });
    expect(parseNoteLinkUrl("plainva://open?path=%E0%A4%A.md")).toEqual({ ok: false, reason: "malformed" });
    expect(parseNoteLinkUrl("plainva://open?path=a.md&path=b.md")).toEqual({ ok: false, reason: "malformed" });
    expect(parseNoteLinkUrl("plainva://open?path=a.md&heading=H&block=x")).toEqual({ ok: false, reason: "anchor" });
    for (const block of ["", "-x", "a b", "a_b", "x".repeat(65), "%3Cscript%3E"]) {
      expect(parseNoteLinkUrl(`plainva://open?path=a.md&block=${block}`), block).toEqual({ ok: false, reason: "anchor" });
    }
    expect(parseNoteLinkUrl("plainva://open?path=a.md&vault=")).toEqual({ ok: false, reason: "vault" });
  });

  it("ignores parameters it does not know — none of them does anything", () => {
    expect(parseNoteLinkUrl("plainva://open?path=a.md&exec=rm&create=1&content=x")).toEqual({ ok: true, target: { vault: null, path: "a.md" } });
  });

  it("refuses to build a link it would not open", () => {
    expect(() => buildNoteLinkUrl({ vault: null, path: "../x.md" })).toThrow();
    expect(() => buildNoteLinkUrl({ vault: null, path: "a.md", block: "a b" })).toThrow();
  });

  it("tells a Plainva address from any other", () => {
    expect(isNoteLinkAddress("plainva://open?path=a.md")).toBe(true);
    expect(isNoteLinkAddress("  Plainva-Labs://x")).toBe(true);
    expect(isNoteLinkAddress("plainva://graph")).toBe(true);
    expect(isNoteLinkAddress("https://plainva.com")).toBe(false);
    expect(isNoteLinkAddress("plainvax://open")).toBe(false);
    expect(isNoteLinkAddress(undefined)).toBe(false);
  });
});

describe("where an address leads", () => {
  it("asks the link rule for the path without `.md`, then for the file name — never for a name it would cut", () => {
    expect(noteLinkNameCandidates("Projects/Plan.md")).toEqual(["Projects/Plan", "Plan"]);
    expect(noteLinkNameCandidates("Plan.md")).toEqual(["Plan"]);
    expect(noteLinkNameCandidates("A/Draft #1.md")).toEqual([]);
    expect(noteLinkNameCandidates("Report.base")).toEqual(["Report.base"]);
  });

  it("writes the wiki link of a place", () => {
    expect(wikiLinkText("Plan", {})).toBe("[[Plan]]");
    expect(wikiLinkText("Plan", { heading: "Goals" })).toBe("[[Plan#Goals]]");
    expect(wikiLinkText("Plan", { block: "ab12cd" })).toBe("[[Plan#^ab12cd]]");
  });

  it("chooses the vault: the shown one, another by name only to ask about, several or none said as such", () => {
    const shown = { key: "/a", name: "Work" };
    const known = [shown, { key: "/b", name: "Private" }, { key: "/c", name: "Twin" }, { key: "/d", name: "twin" }];
    expect(chooseLinkVault("work", shown, known)).toEqual({ kind: "here" });
    expect(chooseLinkVault(null, shown, known)).toEqual({ kind: "here" });
    expect(chooseLinkVault(null, null, known)).toEqual({ kind: "unknown" });
    expect(chooseLinkVault("Private", shown, known)).toEqual({ kind: "switch", vault: { key: "/b", name: "Private" } });
    expect(chooseLinkVault("Twin", shown, known)).toEqual({ kind: "ambiguous" });
    expect(chooseLinkVault("Elsewhere", shown, known)).toEqual({ kind: "unknown" });
    expect(chooseLinkVault("Private", null, known)).toEqual({ kind: "switch", vault: { key: "/b", name: "Private" } });
  });
});
