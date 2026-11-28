// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { AreaBoundary, emojiColonCompletionSource, errorText, isPartLoadFailure, lazyPart, PART_LOAD_TIMEOUT_MS, PartLoadError, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { loadSuggestionDiff } from "../../../packages/ui/src/components/suggestMode";
import { loadSyncXmlTargets, requireSyncXmlTargets } from "./services/syncXmlTargetsLoad";

/**
 * Each way B1b loads on demand, when its load fails and when it hangs (review of B1b, round 1, M-2): the emoji
 * catalog of the `:name` completion, the S3/WebDAV targets of a vault's open, the suggestion mode's word diff, the
 * quiet toast of an area whose part did not load, and the browsers' sentence for a style sheet that did not load.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
});

type Catalog = Awaited<ReturnType<NonNullable<Parameters<typeof emojiColonCompletionSource>[0]>>>;
const catalog = { searchEmoji: () => [{ char: "\u{1F604}", name: "smile" }] } as unknown as Catalog;
const contextAt = (doc: string) => new CompletionContext(EditorState.create({ doc }), doc.length, false);
const never = <T,>() => new Promise<T>(() => undefined);

describe("the emoji catalog, loaded with the first :name", () => {
  it("a failed load offers nothing, and the next :name loads again", async () => {
    expect.hasAssertions();
    const load = vi.fn<() => Promise<Catalog>>().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValueOnce(catalog);
    const source = emojiColonCompletionSource(load);
    expect(await source(contextAt("Nice :smile"))).toBeNull();
    const second = await source(contextAt("Nice :smile"));
    expect(second?.options[0]?.apply).toBe("\u{1F604}");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a load that hangs ends after the part load's end with nothing offered, and the next :name loads again", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const load = vi.fn<() => Promise<Catalog>>().mockImplementationOnce(never).mockResolvedValueOnce(catalog);
    const source = emojiColonCompletionSource(load);
    const first = source(contextAt("Nice :smile"));
    await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS + 10);
    expect(await first).toBeNull();
    expect((await source(contextAt("Nice :smile")))?.options.length).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a completion the editor gave up on while the catalog loaded offers nothing", async () => {
    expect.hasAssertions();
    const source = emojiColonCompletionSource(async () => catalog);
    const context = contextAt("Nice :smile");
    const pending = source(context);
    Object.defineProperty(context, "aborted", { value: true });
    expect(await pending).toBeNull();
  });
});

describe("the S3 and WebDAV targets at a vault's open", () => {
  it("are not loaded for a vault that needs neither", async () => {
    expect.hasAssertions();
    const load = vi.fn(async () => ({}) as never);
    expect(await loadSyncXmlTargets(false, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("a failed load ends the open with the app's words", async () => {
    expect.hasAssertions();
    const error = await loadSyncXmlTargets(true, () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/syncXmlTargets.js"))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartLoadError);
    expect(errorText(error)).toBe(i18n.t("errors.partLoad"));
  });

  it("a load that hangs ends the open after the part load's end", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const pending = loadSyncXmlTargets(true, never).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS + 10);
    const error = await pending;
    expect(error).toBeInstanceOf(PartLoadError);
    expect((error as PartLoadError).reason).toBe("timeout");
  });

  it("a vault that syncs through one never goes on without its target", () => {
    expect.hasAssertions();
    expect(() => requireSyncXmlTargets(null, "s3")).toThrow("the s3 target did not load");
    expect(() => requireSyncXmlTargets(null, "webdav")).toThrow("the webdav target did not load");
  });
});

describe("the suggestion mode's word diff", () => {
  it("a load that hangs ends after its tries, so a send that waits for it ends too", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const load = vi.fn(never as () => Promise<{ presentableDiff: never }>);
    const pending = loadSuggestionDiff(load).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3 * PART_LOAD_TIMEOUT_MS + 2000);
    const error = await pending;
    expect(error).toBeInstanceOf(PartLoadError);
    expect(load).toHaveBeenCalledTimes(3);
    expect(errorText(error)).toBe(i18n.t("errors.partLoad"));
  });
});

describe("the words for a load that failed", () => {
  it("count the browsers' sentence for a style sheet that did not load", () => {
    expect.hasAssertions();
    expect(isPartLoadFailure(new Error("Unable to preload CSS for /assets/Editor-x.css"))).toBe(true);
    expect(errorText(new Error("Unable to preload CSS for /assets/Editor-x.css"))).toBe(i18n.t("errors.partLoad"));
  });

  it("a quiet area whose part did not load says so in its toast, not as a crash", async () => {
    expect.hasAssertions();
    const warning = vi.spyOn(toast, "warning");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Part = lazyPart(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<AreaBoundary area="test:quietOuter" size="quiet"><Suspense fallback={null}><Part /></Suspense></AreaBoundary>));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(warning).toHaveBeenCalledWith(i18n.t("errors.partLoadTitle"));
    expect(warning).not.toHaveBeenCalledWith(i18n.t("errors.areaTitle"));
    warning.mockRestore();
    quiet.mockRestore();
    act(() => root.unmount());
  });
});
