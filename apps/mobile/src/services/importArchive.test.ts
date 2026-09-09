import { afterEach, describe, expect, it, vi } from "vitest";
import { Inflate, Zip, ZipDeflate, zipSync, strToU8 } from "fflate";
import { extractArchive, isArchiveName } from "./importArchive";

afterEach(() => vi.restoreAllMocks());

/** A ZIP can lie consistently in both its local and central size fields. */
function lieAboutSizes(input: Uint8Array): Uint8Array {
  const bytes = input.slice(), view = new DataView(bytes.buffer);
  for (let i = 0; i + 28 < bytes.length; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, 1, true);
    if (signature === 0x02014b50) view.setUint32(i + 24, 1, true);
  }
  return bytes;
}

/**
 * The phone unpacks in the WebView where the desktop uses a Rust extractor
 * (S40). The rules are shared, so what has to be proven here is that this
 * binding actually applies them — a guard that is imported but not consulted
 * looks exactly like a guard that works.
 */
describe("mobile import archive", () => {
  it("supports streaming ZIP data descriptors without a size in the local header", async () => {
    const parts: Uint8Array[] = [];
    const archive = new Zip((error, bytes) => { if (error) throw error; parts.push(bytes); });
    const entry = new ZipDeflate("stream.md"); archive.add(entry);
    const content = "Streaming text. ".repeat(400);
    entry.push(strToU8(content), true); archive.end();
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    expect((await extractArchive(bytes)).files[0].content).toBe(content);
    const limited = await extractArchive(bytes, { maxEntryBytes: 1024, maxTotalBytes: 10000, maxEntries: 10 });
    expect(limited.files).toEqual([]); expect(limited.skipped).toEqual([{ relativePath: "stream.md", reason: "too_large" }]);
  });
  it("bounds stored entries by actual bytes as well", async () => {
    const original = strToU8("stored".repeat(2000)), zip = zipSync({ "stored.bin": original }, { level: 0 });
    expect((await extractArchive(zip)).files[0].bytes).toEqual(original);
    const limited = await extractArchive(lieAboutSizes(zip), { maxEntryBytes: 1024, maxTotalBytes: 20000, maxEntries: 10 });
    expect(limited.files).toEqual([]); expect(limited.skipped).toEqual([{ relativePath: "stored.bin", reason: "too_large" }]);
  });
  it("stops real inflation before producing a whole file whose declared size lies", async () => {
    const original = Inflate.prototype.push;
    let expanded = 0;
    vi.spyOn(Inflate.prototype, "push").mockImplementation(function (this: Inflate, chunk, final) {
      const ondata = this.ondata;
      this.ondata = (data, last) => { expanded += data.byteLength; ondata(data, last); };
      try { original.call(this, chunk, final); } finally { this.ondata = ondata; }
    });
    const zip = lieAboutSizes(zipSync({ "large.md": strToU8("a".repeat(1024 * 1024)) }));
    const result = await extractArchive(zip, { maxEntryBytes: 1024, maxTotalBytes: 2 * 1024 * 1024, maxEntries: 10 });
    expect(result.files).toEqual([]); expect(result.skipped).toEqual([{ relativePath: "large.md", reason: "too_large" }]);
    // The original implementation produced all 1 MiB before making this decision.
    expect(expanded).toBeGreaterThan(1024); expect(expanded).toBeLessThan(128 * 1024);
  });
  it("rejects a declared oversize entry without constructing its payload", async () => {
    const inflate = vi.spyOn(Inflate.prototype, "push");
    const result = await extractArchive(zipSync({ "large.md": strToU8("a".repeat(1024 * 1024)) }), { maxEntryBytes: 1024, maxTotalBytes: 2048, maxEntries: 10 });
    expect(result.skipped).toHaveLength(1); expect(inflate).not.toHaveBeenCalled();
  });
  it("counts actual expanded bytes across entries and keeps earlier complete files", async () => {
    const zip = lieAboutSizes(zipSync({ "a.md": strToU8("a".repeat(4000)), "b.md": strToU8("b".repeat(4000)), "c.md": strToU8("last") }));
    const result = await extractArchive(zip, { maxEntryBytes: 10000, maxTotalBytes: 5000, maxEntries: 10 });
    expect(result.files.map(file => file.relativePath)).toEqual(["a.md"]);
    expect(result.totalBytes).toBe(4000);
    expect(result.skipped).toEqual([{ relativePath: "b.md", reason: "too_large" }, { relativePath: "c.md", reason: "too_large" }]);
  });
  it("preserves a literal __proto__ entry as an ordinary file", async () => {
    const bytes = strToU8("Literal file contents"), zip = zipSync({ "safe-file": bytes, "note.md": strToU8("A note") });
    // fflate's ZIP writer also uses object keys internally. Build the fixture
    // first, then replace the equal-length name in its local and central headers.
    const before = strToU8("safe-file"), after = strToU8("__proto__");
    for (let i = 0; i <= zip.length - before.length; i++)
      if (before.every((value, offset) => zip[i + offset] === value)) zip.set(after, i);
    const result = await extractArchive(zip);
    expect(result.files.map(file => file.relativePath)).toEqual(["__proto__", "note.md"]);
    expect(result.files[0].bytes).toEqual(bytes); expect(result.skipped).toEqual([]);
  });
  it("drains rejected entries while preserving a later valid one and the file-count ceiling", async () => {
    const zip = zipSync({ "../bad.md": strToU8("unsafe"), "a.md": strToU8("kept"), "b.md": strToU8("over count") });
    const result = await extractArchive(zip, { maxEntryBytes: 100, maxTotalBytes: 200, maxEntries: 1 });
    expect(result.files.map(file => file.relativePath)).toEqual(["a.md"]);
    expect(result.skipped).toEqual([{ relativePath: "../bad.md", reason: "unsafe_path" }, { relativePath: "b.md", reason: "too_large" }]);
  });
  it("reports broken compressed data per entry and rejects a missing ZIP directory", async () => {
    const zip = zipSync({ "broken.md": strToU8("broken".repeat(100)), "valid.md": strToU8("valid") });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    zip[30 + view.getUint16(26, true) + view.getUint16(28, true)] = 0x07; // Reserved DEFLATE block type.
    const result = await extractArchive(zip);
    expect(result.files.map(file => file.relativePath)).toEqual(["valid.md"]);
    expect(result.skipped).toEqual([{ relativePath: "broken.md", reason: "unreadable" }]);
    await expect(extractArchive(zip.slice(0, -10))).rejects.toThrow();
  });
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
