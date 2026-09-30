// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import en from "../../../../packages/ui/src/locales/en.json";
import type { MobileVault } from "../services/vaultService";
import { CommentsScreen } from "./CommentsScreen";

function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        const value = lookup(key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
      },
    }),
  };
});

const state = { mode: "locked" as "locked" | "plain", hasOutbox: false };

vi.mock("../services/mobileComments", () => ({
  listAllMobileComments: vi.fn(async () => new Map()),
  listMobileCommentAuthors: vi.fn(async () => new Map()),
  mobileCommentSelfId: vi.fn(async () => "me"),
  mobileCommentStoreState: vi.fn(async () => state),
}));

vi.mock("../lib/usePullToRefresh", () => ({
  refreshVaultAction: vi.fn(async () => {}),
  usePullToRefresh: () => null,
}));

// The screen and its app bar render a handful of shared pieces. Through the
// package barrels they loaded all of @plainva/ui — the editor, the graph, every
// settings page — and all of @plainva/core, 25 seconds and more before the
// first test, which is why this file needed a 90-second hook (Befunde
// 2026-09-24, Z2). Both barrels are replaced by exactly the modules the screen
// takes from them, the real ones. A new import there fails here with vitest's
// "No … export is defined on the mock"; one line below fixes it.
vi.mock("@plainva/core", async () => ({
  ...(await import("../../../../packages/core/src/comments/legacyCommentImport")),
  ...(await import("../../../../packages/core/src/workspace/commentAnchor")),
}));
vi.mock("@plainva/ui", async () => ({
  ...(await import("../../../../packages/ui/src/components/CommentLegacyLock")),
  ...(await import("../../../../packages/ui/src/components/CommentProvenance")),
  ...(await import("../../../../packages/ui/src/components/ui/Button")),
  ...(await import("../../../../packages/ui/src/components/ui/EmptyState")),
  ...(await import("../../../../packages/ui/src/components/ui/IconButton")),
  ...(await import("../../../../packages/ui/src/components/ui/Segmented")),
  ...(await import("../../../../packages/ui/src/lib/commentAuthor")),
  ...(await import("../../../../packages/ui/src/lib/commentMentions")),
  ...(await import("../../../../packages/ui/src/lib/commentOverviewFocus")),
  ...(await import("../../../../packages/ui/src/lib/commentThreads")),
  ...(await import("../../../../packages/ui/src/lib/iconSizes")),
  ...(await import("../../../../packages/ui/src/lib/noteTitle")),
}));

/**
 * The phone's overview, locked (Nachschaerfung, N3).
 *
 * Same reason as the desktop's: an empty list reads as "nobody is waiting",
 * when the truth is "this phone cannot read the remarks yet". The screen has
 * to say so and offer the way out - the request goes to the shell, which
 * opens the sync screen where the passphrase is entered.
 */
describe("the comments screen, locked", () => {
  it("explains, offers the unlock, and asks the shell for the sync screen", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<CommentsScreen vault={{ vaultId: "local" } as MobileVault} onOpenNote={() => {}} />); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(tr("comments.commentsLocked"));
    expect(host.textContent).not.toContain(tr("comments.commentOverviewNone"));

    let asked = 0;
    const onUnlock = () => { asked += 1; };
    window.addEventListener("m-comments-unlock", onUnlock);
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    window.removeEventListener("m-comments-unlock", onUnlock);
    expect(asked).toBe(1);

    await act(async () => { root.unmount(); });
    host.remove();
  });

  it("shows the plain empty state again once the phone is unlocked", async () => {
    state.mode = "plain";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<CommentsScreen vault={{ vaultId: "local" } as MobileVault} onOpenNote={() => {}} />); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(tr("comments.commentOverviewNone"));
    expect(host.querySelector('[data-testid="comments-unlock"]')).toBeNull();
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
