// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { embedTargetKindOf, fileEmbedCardModel, mountFileEmbedCard, parseWikiImageTarget, resolveNoteEmbed } from "@plainva/ui";

/** Plan Rückmeldungen 05.11., P4: a file embed is a card, not a note read as text. */
describe("embedTargetKindOf", () => {
  it("tells pictures, sounds, notes and every other file apart", () => {
    expect(embedTargetKindOf("Anhänge/foto.png")).toBe("image");
    expect(embedTargetKindOf("memo.m4a")).toBe("audio");
    expect(embedTargetKindOf("Projekte/Plan.md")).toBe("note");
    expect(embedTargetKindOf("Aufgaben.base")).toBe("note");
    expect(embedTargetKindOf("Skizze.canvas")).toBe("note");
    expect(embedTargetKindOf("Anhänge/Mietvertrag.pdf")).toBe("file");
    expect(embedTargetKindOf("file.zip")).toBe("file");
    expect(embedTargetKindOf("sheet.xlsx")).toBe("file");
    expect(embedTargetKindOf("clip.mp4")).toBe("file");
    expect(embedTargetKindOf("data.csv")).toBe("file");
    expect(embedTargetKindOf("LICENSE")).toBe("file");
  });

  it("ignores case and reads only the file's own name", () => {
    expect(embedTargetKindOf("SCAN.PDF")).toBe("file");
    expect(embedTargetKindOf("Notiz.MD")).toBe("note");
    expect(embedTargetKindOf("Foto.JPG")).toBe("image");
    expect(embedTargetKindOf("v1.2.md")).toBe("note");
    expect(embedTargetKindOf("Ordner.pdf/Notiz.md")).toBe("note");
  });

  it("reads the target of an embed with Obsidian's suffixes", () => {
    expect(embedTargetKindOf(parseWikiImageTarget("Mietvertrag.pdf#height=600").target)).toBe("file");
    expect(embedTargetKindOf(parseWikiImageTarget("Mietvertrag.pdf#page=3|Vertrag").target)).toBe("file");
    expect(embedTargetKindOf(parseWikiImageTarget("foto.png|300").target)).toBe("image");
  });

  it("resolves an embed with a #height= suffix to the file itself", async () => {
    const resolve = vi.fn(async (name: string) => (name === "Mietvertrag.pdf" ? "Anhänge/Mietvertrag.pdf" : null));
    const found = await resolveNoteEmbed("Mietvertrag.pdf#height=600", "Wohnung.md", { resolve });
    expect(found).toEqual({ status: "found", path: "Anhänge/Mietvertrag.pdf", anchor: "#height=600" });
    expect(embedTargetKindOf(found.status === "found" ? found.path : "")).toBe("file");
    expect(await resolveNoteEmbed("Fehlt.pdf", "Wohnung.md", { resolve })).toEqual({ status: "missing" });
  });
});

describe("file embed card", () => {
  it("names the file, its size and its folder", () => {
    expect(fileEmbedCardModel("Anhänge/Mietvertrag.pdf", 1887437)).toEqual({ name: "Mietvertrag.pdf", badge: "PDF", meta: "1.8 MB · Anhänge/" });
    expect(fileEmbedCardModel("file.zip", 512)).toEqual({ name: "file.zip", badge: "ZIP", meta: "512 B" });
    expect(fileEmbedCardModel("a/b/sheet.xlsx", null)).toEqual({ name: "sheet.xlsx", badge: "XLSX", meta: "a/b/" });
    expect(fileEmbedCardModel("LICENSE", null)).toEqual({ name: "LICENSE", badge: "", meta: "" });
  });

  it("opens the file through the shell and keeps the press to itself", () => {
    const host = document.createElement("div");
    const outer = vi.fn();
    host.addEventListener("click", outer);
    const onOpen = vi.fn();
    const cleanup = mountFileEmbedCard(host, { path: "Anhänge/Mietvertrag.pdf", size: 2048, onOpen });
    const card = host.querySelector<HTMLElement>("[data-testid=file-embed]")!;
    expect(card.dataset.path).toBe("Anhänge/Mietvertrag.pdf");
    expect(card.querySelector(".pv-filecard-name")?.textContent).toBe("Mietvertrag.pdf");
    expect(card.querySelector(".pv-filecard-meta")?.textContent).toBe("2.0 KB · Anhänge/");
    host.querySelector<HTMLButtonElement>("[data-testid=file-embed-open]")!.click();
    expect(onOpen).toHaveBeenCalledWith("Anhänge/Mietvertrag.pdf");
    expect(outer).not.toHaveBeenCalled();
    cleanup();
    expect(host.children.length).toBe(0);
  });
});
