// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLink } from "../services/openLink";

/**
 * A click on a link in an AI answer (review O7, fifth round) goes the way every link of the app goes
 * (`planLinkOpen` through `openLink`), by how it is written — the same function the answer's source check asks.
 * Before, both shells handed the text to the wiki rule as it stood: `[p](Pricing%202026.md)` found nothing. A
 * missing note is not created from an answer: it is not the user's own text.
 */
const t = (key: string) => key;

afterEach(() => vi.restoreAllMocks());

describe("a link in an AI answer, clicked", () => {
  it("a Markdown link is led by the Markdown rule, its destination decoded", async () => {
    const resolveMarkdownLink = vi.fn(async (target: string) => (target === "Pricing 2026.md" ? { kind: "file" as const, path: "Pricing 2026.md" } : null));
    const resolveNotePath = vi.fn(async () => null);
    const opened: string[] = [];
    await openLink({ text: "Pricing%202026.md", kind: "markdown" }, { queryService: { resolveNotePath, resolveMarkdownLink }, vaultAdapter: null, onOpenPath: (path) => opened.push(path), newTab: false, t, createMissing: false });
    expect(resolveMarkdownLink).toHaveBeenCalledWith("Pricing 2026.md", undefined);
    expect(opened).toEqual(["Pricing 2026.md"]);
  });

  it("a note that is not there is not created from an answer — and is, from the user's own text", async () => {
    const created: unknown[] = [];
    const listen = (event: Event) => created.push((event as CustomEvent).detail);
    window.addEventListener("plainva-create-note-from-link", listen);
    const queryService = { resolveNotePath: async () => null, resolveMarkdownLink: async () => null };
    const opened: string[] = [];
    await openLink({ text: "Ideas 2027", kind: "wiki" }, { queryService, vaultAdapter: null, onOpenPath: (path) => opened.push(path), newTab: false, t, createMissing: false });
    expect(created).toEqual([]);
    expect(opened).toEqual([]);
    await openLink({ text: "Ideas 2027", kind: "wiki" }, { queryService, vaultAdapter: null, onOpenPath: (path) => opened.push(path), newTab: false, t });
    expect(created).toHaveLength(1);
    window.removeEventListener("plainva-create-note-from-link", listen);
  });
});
