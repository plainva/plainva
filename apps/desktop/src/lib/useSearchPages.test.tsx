// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SearchPage, SearchPageCursor } from "@plainva/core";
import { errorText, useSearchPages } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });
const hit = (path: string) => ({ id: path, path, title: path, snippet: path, mtime_local: 1, size_bytes: 1 });
const cursor: SearchPageCursor = { query: "current", noteOffset: 16, from: 0 };

describe("paged search requests", () => {
  it("discards obsolete answers, cancels unmounted requests, and preserves rows on a page error", async () => {
    const calls: { query: string; signal?: AbortSignal; resolve: (value: SearchPage) => void; reject: (error: Error) => void }[] = [];
    const service = { searchOccurrencesPage: vi.fn((query: string, options?: { signal?: AbortSignal }) => new Promise<SearchPage>((resolve, reject) => calls.push({ query, signal: options?.signal, resolve, reject }))) };
    let value: ReturnType<typeof useSearchPages>;
    function Probe({ query }: { query: string }) { value = useSearchPages(service, query); return <div>{value.hits.map(r => r.path).join(",")}</div>; }
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<Probe query="old" />); });
    await act(async () => { root!.render(<Probe query="current" />); });
    expect(calls[0].signal?.aborted).toBe(true);
    await act(async () => { calls[1].resolve({ hits: [hit("current.md")], next: cursor }); });
    await act(async () => { calls[0].resolve({ hits: [hit("old.md")], next: null }); });
    expect(host.textContent).toBe("current.md");
    await act(async () => { value!.loadMore(); });
    await act(async () => { calls[2].reject(new Error("database unavailable")); });
    expect(host.textContent).toBe("current.md");
    expect(value!.failed).toBe(true);
    expect(value!.hasMore).toBe(true);
    await act(async () => { value!.loadMore(); });
    await act(async () => { calls[3].resolve({ hits: [hit("current.md"), hit("second.md")], next: null }); });
    expect(host.textContent).toBe("current.md,second.md");
    expect(value!.hasMore).toBe(false);
    await act(async () => { root!.render(<Probe query="last" />); });
    act(() => { root!.unmount(); root = undefined; });
    expect(calls[4].signal?.aborted).toBe(true);
  });

  it("a damaged full-text index is said in a sentence, not as a failure to try again", async () => {
    const damaged = new Error('error returned from database: (code: 267) fts5: corruption found reading blob 1 from table "fts_notes"');
    const service = { searchOccurrencesPage: vi.fn(async () => { throw damaged; }) };
    let value: ReturnType<typeof useSearchPages>;
    function Probe() { value = useSearchPages(service, "hello"); return null; }
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<Probe />); });
    expect(value!.failed).toBe(true);
    expect(value!.damaged).toBe(true);
    // Any other failure stays one to try again.
    service.searchOccurrencesPage.mockImplementationOnce(async () => { throw new Error("database unavailable"); });
    await act(async () => { value!.retry(); });
    expect(value!.failed).toBe(true);
    expect(value!.damaged).toBe(false);
    // Wherever such an error reaches a person, it is the same sentence.
    expect(errorText(damaged)).toBe(i18n.t("errors.fullTextDamaged"));
    expect(errorText(damaged)).not.toContain("267");
  });
});
