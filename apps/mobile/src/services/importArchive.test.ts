import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractArchive, isArchiveName } from "./importArchive";

/**
 * The phone unpacks in the WebView where the desktop uses a Rust extractor
 * (S40). The rules are shared, so what has to be proven here is that this
 * binding actually applies them — a guard that is imported but not consulted
 * looks exactly like a guard that works.
 */
describe("mobile import archive", () => {
  it("decodes text entries and keeps everything else as bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const zip = zipSync({
      "Notes/a.md": strToU8("# Hello"),
      "Notes/img.png": png,
    });

    const out = await extractArchive(zip);
    const md = out.files.find((f) => f.relativePath === "Notes/a.md")!;
    const img = out.files.find((f) => f.relativePath === "Notes/img.png")!;

    expect(md.isText).toBe(true);
    expect(md.content).toBe("# Hello");
    // An attachment must arrive as bytes, not as a decoded string — this is
    // the failure the JSZip era shipped: images were dropped entirely.
    expect(img.isText).toBe(false);
    expect(img.content).toBe("");
    expect(Array.from(img.bytes!)).toEqual(Array.from(png));
    expect(out.skipped).toEqual([]);
  });

  it("refuses an escaping path instead of writing outside the import", async () => {
    const zip = zipSync({ "ok.md": strToU8("fine"), "../escape.md": strToU8("bad") });
    const out = await extractArchive(zip);

    expect(out.files.map((f) => f.relativePath)).toEqual(["ok.md"]);
    expect(out.skipped).toEqual([{ relativePath: "../escape.md", reason: "unsafe_path" }]);
  });

  it("stops at the ceilings and reports what it left out", async () => {
    const zip = zipSync({ "a.md": strToU8("aaaa"), "b.md": strToU8("bbbb") });
    const out = await extractArchive(zip, { maxEntryBytes: 3, maxTotalBytes: 100, maxEntries: 100 });

    expect(out.files).toEqual([]);
    // Silently dropping them would leave the report claiming a full success.
    expect(out.skipped.map((s) => s.reason)).toEqual(["too_large", "too_large"]);
  });

  it("passes a mislabelled binary on as bytes rather than mojibake", async () => {
    // Invalid UTF-8 behind a .md name — decoding it would write junk into a note.
    const zip = zipSync({ "broken.md": new Uint8Array([0xff, 0xfe, 0xff]) });
    const out = await extractArchive(zip);

    expect(out.files[0].isText).toBe(false);
    expect(out.files[0].bytes).toBeDefined();
  });

  it("recognises an archive by name, case-insensitively", () => {
    expect(isArchiveName("Export.ZIP")).toBe(true);
    expect(isArchiveName("notes.md")).toBe(false);
  });
});

describe("mobile import detection", () => {
  it("recognises a source from an unpacked archive, through the shared registry", async () => {
    const { analyzeSelection } = await import("./importService");
    // A Google Keep Takeout: the adapter recognises its own signature, and the
    // point here is that the PHONE's unpack feeds the registry the shape it
    // expects — the registry itself is shared and already covered in core.
    const zip = zipSync({
      "Takeout/Keep/note.json": strToU8(
        JSON.stringify({ title: "T", textContent: "x", isTrashed: false, userEditedTimestampUsec: 1 }),
      ),
    });
    const file = new File([zip as unknown as BlobPart], "takeout.zip");
    const { archive, detected } = await analyzeSelection([file]);

    expect(archive.files.length).toBe(1);
    expect(archive.files[0].isText).toBe(true);
    // Pinned to the SPECIFIC source: a truthy id would also pass if the
    // generic Markdown fallback had claimed it, which is the failure mode.
    expect(detected?.id).toBe("google_keep");
  });

  it("returns no source rather than guessing when nothing claims the input", async () => {
    const { analyzeSelection } = await import("./importService");
    const file = new File([new Uint8Array([1, 2, 3]) as unknown as BlobPart], "mystery.bin");
    const { detected } = await analyzeSelection([file]);
    expect(detected).toBeNull();
  });
});
