import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMock = vi.fn();
const writeMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveMock(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: (...a: unknown[]) => writeMock(...a) }));
vi.mock("@plainva/ui", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));

import { toast } from "@plainva/ui";
import { exportNoteAsMarkdown, referencesRelativeAttachments } from "./exportNote";

describe("referencesRelativeAttachments", () => {
  it("flags wiki embeds and relative MD images, not URLs or data URIs", () => {
    expect(referencesRelativeAttachments("text ![[img.png]] more")).toBe(true);
    expect(referencesRelativeAttachments("![alt](img/pic.png)")).toBe(true);
    expect(referencesRelativeAttachments("![alt](https://example.com/p.png)")).toBe(false);
    expect(referencesRelativeAttachments("![alt](data:image/png;base64,AAA)")).toBe(false);
    expect(referencesRelativeAttachments("plain [[Wiki Link]] text")).toBe(false);
  });
});

describe("exportNoteAsMarkdown", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeMock.mockReset();
    vi.mocked(toast.info).mockClear();
  });

  it("writes the saved note content to the picked path", async () => {
    saveMock.mockResolvedValue("C:/Users/x/Desktop/Note.md");
    const adapter = { readTextFile: vi.fn(async () => "# Note\n\nBody\n") };
    const ok = await exportNoteAsMarkdown(adapter, "Folder/Note.md");
    expect(ok).toBe(true);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Note.md" }));
    expect(writeMock).toHaveBeenCalledWith("C:/Users/x/Desktop/Note.md", "# Note\n\nBody\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("returns false on dialog cancel without reading or writing", async () => {
    saveMock.mockResolvedValue(null);
    const adapter = { readTextFile: vi.fn() };
    expect(await exportNoteAsMarkdown(adapter, "Folder/Note.md")).toBe(false);
    expect(adapter.readTextFile).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("hints once when the note references relative attachments", async () => {
    saveMock.mockResolvedValue("D:/out.md");
    const adapter = { readTextFile: vi.fn(async () => "see ![[diagram.png]]") };
    await exportNoteAsMarkdown(adapter, "Note.md");
    expect(toast.info).toHaveBeenCalledWith("editor.exportAttachmentsHint");
  });
});
