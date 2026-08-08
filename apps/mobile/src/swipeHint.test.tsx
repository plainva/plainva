// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The one-time hint that makes the swipe findable (round 3, R1.1 / E1).
 *
 * The gesture had been complete since S12 and announced by NOTHING — no edge
 * marker, no hint, no first run, no word in the manual. These pin the two
 * halves of what "announced" has to mean: it appears where a swipeable row is,
 * and it appears exactly ONCE per vault.
 */

const settings = { swipeHintSeen: false };
const update = vi.fn(async (patch: Record<string, unknown>) => {
  Object.assign(settings, patch);
});
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => settings,
  updateMobileSettings: update,
}));
// The real module is loaded elsewhere in the app's boot chain, so the mock has
// to keep the exports that chain uses — a bare useTranslation stub breaks the
// import, not the test.
vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const { SwipeHint } = await import("./components/SwipeHint");

// cwd-relative, not `import.meta.url`: under the jsdom environment that is not
// a file URL, and resolving it throws before a single assertion runs.
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  settings.swipeHintSeen = false;
  update.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = () => act(() => root.render(<SwipeHint />));
const text = () => container.textContent ?? "";

describe("the swipe hint", () => {
  it("shows on a vault that has not seen it", () => {
    mount();
    expect(text()).toContain("mobile.swipeHint");
  });

  it("never comes back once dismissed — and remembers it per vault", () => {
    mount();
    const ack = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("mobile.swipeHintAck"),
    );
    expect(ack, "the hint has no way to dismiss it").toBeTruthy();
    act(() => ack!.click());
    // Gone from THIS render without waiting for a settings round-trip …
    expect(text()).not.toContain("mobile.swipeHint");
    // … and written to the per-vault record, so the next mount stays silent.
    expect(update).toHaveBeenCalledWith({ swipeHintSeen: true });
    mount();
    expect(text()).not.toContain("mobile.swipeHint");
  });

  it("stays silent on a vault that has seen it", () => {
    settings.swipeHintSeen = true;
    mount();
    expect(text()).toBe("");
  });

  it("sits on every surface that HAS a swipeable row, above the list", () => {
    // A hint is worthless where the gesture is not, and worthless BELOW the
    // list it describes. The anchor is the LIST CONTAINER, not the first
    // `<SwipeRow`: a row may be built in a helper defined further up the file,
    // so source order is not render order.
    const surfaces: Array<[string, string]> = [
      ["screens/BrowseScreen.tsx", "<RowList>"],
      ["screens/MailListScreen.tsx", '<ul className="m-maillist">'],
    ];
    for (const [file, list] of surfaces) {
      const src = read(file);
      const hintAt = src.indexOf("<SwipeHint />");
      const listAt = src.indexOf(list);
      expect(hintAt, `${file}: no hint on a surface with swipe rows`).toBeGreaterThan(-1);
      expect(listAt, `${file}: list container gone`).toBeGreaterThan(-1);
      expect(hintAt, `${file}: the hint sits below the list it describes`).toBeLessThan(listAt);
      // And the surface really does have the gesture it is talking about.
      expect(src, `${file}: a hint about a gesture the surface does not have`).toContain("<SwipeRow");
    }
  });

  it("is not shown on an empty list", () => {
    // Teaching a gesture on a surface that has no rows to perform it on spends
    // the ONE showing this hint gets per vault on nothing.
    const browse = read("screens/BrowseScreen.tsx");
    const at = browse.indexOf("<SwipeHint />");
    const guard = browse.slice(Math.max(0, at - 260), at);
    expect(guard, "the file list shows the hint even when it is empty").toContain("length > 0");

    const mail = read("screens/MailListScreen.tsx");
    // In the mailbox the hint sits in the branch that renders the list; the
    // empty/error branch is a sibling, so an empty mailbox never teaches.
    const mailAt = mail.indexOf("<SwipeHint />");
    const listAt = mail.indexOf('<ul className="m-maillist">');
    const between = mail.slice(mailAt, listAt);
    expect(between, "the hint is separated from the list it belongs to").not.toContain("EmptyState");
  });

  it("is a per-vault field, not an app-wide one", () => {
    // App-wide would mean: teach once, and every other vault silently assumes
    // the person already knows.
    const scope = read("services/mobileSettingsScope.ts");
    expect(scope).toContain('"swipeHintSeen",');
    expect(scope).toContain("swipeHintSeen: false,");
  });
});
