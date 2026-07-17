import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { buildEmailNoteContent, captureMailAsNote, mailDayKey, mailNoteStem, saveEmlFile, type MailCaptureAdapter } from "./mailCapture";
import type { MailMessage } from "./mailClient";

function fakeAdapter(initial: Record<string, string> = {}) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const adapter: MailCaptureAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (typeof c !== "string") throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    writeBinaryFile: async (p, data) => {
      files.set(p, data);
    },
    exists: async (p) => files.has(p),
    createDir: async () => {},
  };
  return { adapter, files };
}

function msg(partial: Partial<MailMessage> = {}): MailMessage {
  return {
    uid: 4711,
    subject: "Rechnung Q3",
    from: "Anna Beispiel <anna@example.org>",
    to: "marco@example.org",
    dateTs: new Date(2026, 6, 20, 9, 30).getTime(),
    text: "Hallo,\n\nanbei die Rechnung.\n",
    html: null,
    attachments: [],
    ...partial,
  };
}

describe("mail capture", () => {
  it("builds an anchored Email note with sender, date and the text body", () => {
    const content = buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20");
    expect(readFrontmatterPath(content, ["type"])).toBe("Email");
    expect(readFrontmatterPath(content, ["from"])).toBe("Anna Beispiel <anna@example.org>");
    expect(readFrontmatterPath(content, ["date"])).toBe("2026-07-20");
    expect(readFrontmatterPath(content, ["plainva", "pim", "kind"])).toBe("email");
    expect(readFrontmatterPath(content, ["plainva", "pim", "uid"])).toBe(4711);
    expect(content).toContain("# Rechnung Q3");
    expect(content).toContain("anbei die Rechnung.");
  });

  it("creates the note in the mail folder and is idempotent per message", async () => {
    const { adapter, files } = fakeAdapter();
    const first = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(first).toEqual({ path: "Mail/2026-07-20 Rechnung Q3.md", created: true });
    const again = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(again).toEqual({ path: first.path, created: false });
    expect([...files.keys()].filter((p) => p.endsWith(".md"))).toHaveLength(1);
  });

  it("never reuses a same-named foreign note", async () => {
    const { adapter } = fakeAdapter({ "Mail/2026-07-20 Rechnung Q3.md": "# Eigene Notiz ohne Anker\n" });
    const res = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(res).toEqual({ path: "Mail/2026-07-20 Rechnung Q3 2.md", created: true });
  });

  it("saves the raw message as a collision-free .eml", async () => {
    const { adapter, files } = fakeAdapter();
    const raw = btoa("From: a@example.org\r\n\r\nBody");
    const path = await saveEmlFile(adapter, msg(), raw, "Mail");
    expect(path).toBe("Mail/2026-07-20 Rechnung Q3.eml");
    expect(files.get(path)).toBeInstanceOf(Uint8Array);
    const second = await saveEmlFile(adapter, msg(), raw, "Mail");
    expect(second).toBe("Mail/2026-07-20 Rechnung Q3 2.eml");
  });

  it("stems/day keys degrade gracefully", () => {
    expect(mailNoteStem("2026-07-20", "???")).toBe("2026-07-20");
    expect(mailDayKey({ dateTs: 0 })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
