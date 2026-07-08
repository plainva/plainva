import { describe, expect, it } from "vitest";
import { isEditableImage, isImagePath, saveCanvasToVault } from "./imageFiles";

describe("image dispatch", () => {
  it("recognizes image extensions case-insensitively", () => {
    expect(isImagePath("Bilder/foto.PNG")).toBe(true);
    expect(isImagePath("a/b.webp")).toBe(true);
    expect(isImagePath("scan.pdf")).toBe(false);
    expect(isImagePath("Note.md")).toBe(false);
    expect(isImagePath("ohneendung")).toBe(false);
  });

  it("treats only canvas-encodable formats as editable", () => {
    expect(isEditableImage("a.png")).toBe(true);
    expect(isEditableImage("a.jpeg")).toBe(true);
    expect(isEditableImage("a.webp")).toBe(true);
    expect(isEditableImage("a.gif")).toBe(false);
    expect(isEditableImage("a.svg")).toBe(false);
    expect(isEditableImage("a.avif")).toBe(false);
  });
});

describe("saveCanvasToVault", () => {
  it("writes the encoded bytes through the adapter", async () => {
    const written: Record<string, Uint8Array> = {};
    const adapter = {
      writeBinaryFile: async (p: string, c: Uint8Array) => {
        written[p] = c;
      },
    };
    const canvas = {
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1, 2, 3])])),
    } as unknown as HTMLCanvasElement;
    await saveCanvasToVault(adapter, "Bilder/foto.png", canvas, "image/png");
    expect([...written["Bilder/foto.png"]]).toEqual([1, 2, 3]);
  });

  it("throws when the encoder returns null", async () => {
    const adapter = { writeBinaryFile: async () => {} };
    const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
    await expect(saveCanvasToVault(adapter, "x.png", canvas, "image/png")).rejects.toThrow(/encoding/);
  });
});
