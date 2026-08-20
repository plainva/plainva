import { beforeEach, describe, expect, it, vi } from "vitest";

const prompt = vi.fn();
vi.mock("./services/mobileDialogs", () => ({ mPrompt: (o: unknown) => prompt(o) }));
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ templateFolder: "Templates", defaultNoteType: "Note" }),
}));

import { createTemplatePrompt } from "./services/templatePrompt";
import type { MobileVault } from "./services/vaultService";

/**
 * Creating a template on the phone (parity gap template-authoring, closed
 * 2026-08-20).
 *
 * Runs the REAL shared rule (createTemplateIn) against a fake adapter — only
 * the prompt and the settings are stubbed. Stubbing the rule itself would test
 * the stub, which is what left two mocks running dead in this repo before.
 */

const t = ((k: string) => k) as never;

function fakeVault(files = new Map<string, string>()) {
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p) || dirs.has(p),
        createDir: async (p: string) => {
          dirs.add(p);
        },
        writeTextFile: async (p: string, c: string) => {
          files.set(p, c);
        },
        readTextFile: async (p: string) => files.get(p) ?? "",
      },
    } as unknown as MobileVault,
  };
}

describe("creating a template on the phone", () => {
  beforeEach(() => prompt.mockReset());

  it("writes it into the configured folder, seeded so notes inherit their name", async () => {
    prompt.mockResolvedValue({ value: "Meeting", cancelled: false });
    const { vault, files } = fakeVault();

    const path = await createTemplatePrompt(vault, t);

    expect(path).toBe("Templates/Meeting.md");
    // {{title}} is what makes a note created FROM this template carry its own
    // file name as the H1 — a blank template would silently drop that.
    expect(files.get(path!)).toContain("# {{title}}");
    // And the template keeps itself out of the Tasks view, same as on desktop.
    expect(files.get(path!)).toContain("tasks: false");
  });

  it("writes nothing when the name prompt is cancelled", async () => {
    prompt.mockResolvedValue({ value: "Meeting", cancelled: true });
    const { vault, files } = fakeVault();

    expect(await createTemplatePrompt(vault, t)).toBeNull();
    expect(files.size).toBe(0);
  });

  it("keeps a typed slash from turning the name into a path", async () => {
    prompt.mockResolvedValue({ value: "Q3/Review", cancelled: false });
    const { vault } = fakeVault();

    expect(await createTemplatePrompt(vault, t)).toBe("Templates/Q3-Review.md");
  });

  it("numbers a collision instead of overwriting the existing template", async () => {
    prompt.mockResolvedValue({ value: "Meeting", cancelled: false });
    const files = new Map([["Templates/Meeting.md", "the one that was there"]]);
    const { vault } = fakeVault(files);

    expect(await createTemplatePrompt(vault, t)).toBe("Templates/Meeting 2.md");
    expect(files.get("Templates/Meeting.md")).toBe("the one that was there");
  });
});
