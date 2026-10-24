import { describe, expect, it } from "vitest";
import { attachmentFileName, attachmentFolder, saveMailAttachment, type AttachmentSaveAdapter } from "@plainva/ui/mail";

/**
 * Saving a received attachment into the vault — the rule both shells read
 * (plan "Weiterleiten nimmt die Anhänge mit", Teil C; Sammelplan § 3.59).
 *
 * The rule came out of the phone's message screen. What it did there is held
 * here, so the desktop cannot save the same file somewhere else.
 */

/** A vault that is a map of paths: what was written, and what was asked. */
function memoryVault(existing: string[] = []) {
  const files = new Map<string, Uint8Array>(existing.map((path) => [path, new Uint8Array()]));
  const dirs: string[] = [];
  const adapter: AttachmentSaveAdapter = {
    exists: async (path) => files.has(path),
    createDir: async (path) => {
      dirs.push(path);
    },
    writeBinaryFile: async (path, data) => {
      files.set(path, data);
    },
  };
  return { adapter, files, dirs };
}

describe("where a saved attachment goes", () => {
  it("is the Attachments folder under the mail folder", () => {
    expect(attachmentFolder("Mail")).toBe("Mail/Attachments");
    expect(attachmentFolder("Ablage/E-Mail/")).toBe("Ablage/E-Mail/Attachments");
    expect(attachmentFolder("/Post")).toBe("Post/Attachments");
    // No folder set: the one captured mail lands in by default.
    expect(attachmentFolder("")).toBe("Mail/Attachments");
    expect(attachmentFolder("  ")).toBe("Mail/Attachments");
  });
});

describe("what a saved attachment is called", () => {
  it("keeps the sender's name where it is a file name", () => {
    expect(attachmentFileName("Rechnung 2026-104.pdf")).toEqual({ stem: "Rechnung 2026-104", ext: "pdf" });
    expect(attachmentFileName("archiv.tar.gz")).toEqual({ stem: "archiv.tar", ext: "gz" });
    expect(attachmentFileName("Übersicht 日本語.PDF")).toEqual({ stem: "Übersicht 日本語", ext: "PDF" });
  });

  it("makes a usable name out of one that is not", () => {
    // Reserved characters and separators cannot be part of a file name.
    expect(attachmentFileName('a/b\\c:d*e?"f<g>h|i.txt')).toEqual({ stem: "a b c d e f g h i", ext: "txt" });
    // No extension, or one that is not letters and digits: the whole name is
    // the stem, and the file is saved as what it is — unknown.
    expect(attachmentFileName("LIESMICH")).toEqual({ stem: "LIESMICH", ext: "bin" });
    expect(attachmentFileName("Bericht.final version")).toEqual({ stem: "Bericht.final version", ext: "bin" });
    expect(attachmentFileName("x.../../etc")).toEqual({ stem: "x... .. etc", ext: "bin" });
    // Nothing usable at all.
    expect(attachmentFileName("")).toEqual({ stem: "attachment", ext: "bin" });
    expect(attachmentFileName("???")).toEqual({ stem: "attachment", ext: "bin" });
  });

  it("leaves out what is no part of any name: control characters, wherever they stand", () => {
    // Built at run time: a control character has no business in a source file.
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const DEL = String.fromCharCode(127);
    expect(attachmentFileName(`be${NUL}richt${BEL}.pdf`)).toEqual({ stem: "be richt", ext: "pdf" });
    expect(attachmentFileName(`${DEL}${NUL}`)).toEqual({ stem: "attachment", ext: "bin" });
    // One inside the extension: what follows the dot is then no extension, and
    // the file is saved as unknown rather than under half a type.
    expect(attachmentFileName(`a.p${NUL}df`)).toEqual({ stem: "a.p df", ext: "bin" });
  });

  it("does not write to a device: the names Windows keeps get a mark in front", () => {
    // `NUL.txt` cannot be created on Windows, with any extension; where it
    // seems to work the bytes go to the device and the file is not there.
    expect(attachmentFileName("NUL.txt")).toEqual({ stem: "_NUL", ext: "txt" });
    expect(attachmentFileName("con")).toEqual({ stem: "_con", ext: "bin" });
    expect(attachmentFileName("COM1.tar.gz")).toEqual({ stem: "_COM1.tar", ext: "gz" });
    expect(attachmentFileName("Lpt9 .pdf")).toEqual({ stem: "_Lpt9", ext: "pdf" });
    expect(attachmentFileName("aux.")).toEqual({ stem: "_aux", ext: "bin" });
    // Names that only begin like one are names.
    expect(attachmentFileName("console.log")).toEqual({ stem: "console", ext: "log" });
    expect(attachmentFileName("nullable.txt")).toEqual({ stem: "nullable", ext: "txt" });
    expect(attachmentFileName("COM10.txt")).toEqual({ stem: "COM10", ext: "txt" });
  });

  it("cuts a name no file system takes, on a whole character and not on a blank", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    // Two bytes a character: the cut falls between characters, never inside one.
    const long = attachmentFileName(`${"ä".repeat(300)}.pdf`);
    expect(long.ext).toBe("pdf");
    expect(long.stem).toBe("ä".repeat(90));
    expect(bytes(`${long.stem}-99.${long.ext}`)).toBeLessThanOrEqual(255);
    // Four bytes a character.
    expect(attachmentFileName(`${"😀".repeat(100)}.png`).stem).toBe("😀".repeat(45));
    // The cut would end on the blank before the next word: the blank goes too.
    expect(attachmentFileName(`${"a".repeat(179)} und weiter.pdf`).stem).toBe("a".repeat(179));
    // A name within the bound is not touched.
    expect(attachmentFileName(`${"b".repeat(180)}.pdf`).stem).toBe("b".repeat(180));
  });

  it("never saves a file that starts with a dot", () => {
    // A name like this is a hidden file on two of three desktop systems, and
    // Plainva's own tree does not show it.
    expect(attachmentFileName(".htaccess")).toEqual({ stem: "attachment", ext: "htaccess" });
    expect(attachmentFileName("..versteckt.pdf")).toEqual({ stem: "versteckt", ext: "pdf" });
    expect(attachmentFileName(". . .pdf")).toEqual({ stem: "attachment", ext: "pdf" });
  });
});

describe("saving", () => {
  it("writes the file's bytes under the mail folder and says where", async () => {
    const vault = memoryVault();
    const path = await saveMailAttachment(vault.adapter, "Mail", "doc.pdf", "JVBERi0=");
    expect(path).toBe("Mail/Attachments/doc.pdf");
    expect(vault.dirs).toEqual(["Mail/Attachments"]);
    expect(Array.from(vault.files.get(path)!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  });

  it("never writes over a file that is there: two mails may carry the same name", async () => {
    const vault = memoryVault(["Mail/Attachments/scan.pdf", "Mail/Attachments/scan-2.pdf"]);
    const path = await saveMailAttachment(vault.adapter, "Mail", "scan.pdf", "AAEC");
    expect(path).toBe("Mail/Attachments/scan-3.pdf");
    expect(vault.files.get("Mail/Attachments/scan.pdf")).toEqual(new Uint8Array());
    expect(Array.from(vault.files.get(path)!)).toEqual([0, 1, 2]);
  });

  it("saves a file with a device's name as a file", async () => {
    const vault = memoryVault();
    await expect(saveMailAttachment(vault.adapter, "Mail", "NUL.pdf", "AAEC")).resolves.toBe("Mail/Attachments/_NUL.pdf");
    expect(Array.from(vault.files.get("Mail/Attachments/_NUL.pdf")!)).toEqual([0, 1, 2]);
  });

  it("keeps every byte of a file that is not text", async () => {
    const vault = memoryVault();
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    let binary = "";
    for (const byte of all) binary += String.fromCharCode(byte);
    const path = await saveMailAttachment(vault.adapter, "Mail", "bytes.bin", btoa(binary));
    expect(Array.from(vault.files.get(path)!)).toEqual(Array.from(all));
  });

  it("saves into an existing folder all the same", async () => {
    const vault = memoryVault();
    vault.adapter.createDir = async () => {
      throw new Error("exists");
    };
    await expect(saveMailAttachment(vault.adapter, "Mail", "a.txt", "")).resolves.toBe("Mail/Attachments/a.txt");
  });
});
