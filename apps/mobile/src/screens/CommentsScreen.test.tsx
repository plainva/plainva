// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import en from "../../../../packages/ui/src/locales/en.json";
import type { MobileVault } from "../services/vaultService";

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

/**
 * The phone's overview, locked (Nachschaerfung, N3).
 *
 * Same reason as the desktop's: an empty list reads as "nobody is waiting",
 * when the truth is "this phone cannot read the remarks yet". The screen has
 * to say so and offer the way out - the request goes to the shell, which
 * opens the sync screen where the passphrase is entered.
 */
// Load the screen once, outside anybody's assertion budget: the first test
// would otherwise pay for compiling the whole module graph (see the same
// hook in securitySharingPage.test.tsx).
beforeAll(async () => { await import("./CommentsScreen"); }, 30000);

describe("the comments screen, locked", () => {
  it("explains, offers the unlock, and asks the shell for the sync screen", async () => {
    const { CommentsScreen } = await import("./CommentsScreen");
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
    const { CommentsScreen } = await import("./CommentsScreen");
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
