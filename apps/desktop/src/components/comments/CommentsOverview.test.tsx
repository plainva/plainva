// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import en from "../../../../../packages/ui/src/locales/en.json";
import { CommentsOverview } from "./CommentsOverview";

/** The catalogue is nested; a key is a dotted path into it. */
function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
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

/** What the store answers; each test sets the mode it needs. */
const vaultValues: Record<string, unknown> = {
  vaultPath: "/v",
  listAllWorkspaceComments: vi.fn(async () => new Map()),
  listWorkspaceMembers: vi.fn(async () => []),
  getCommentSelfId: vi.fn(async () => "me"),
  getCommentStoreState: vi.fn(async () => ({ mode: "locked", hasOutbox: false })),
};

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => vaultValues,
}));

// The overview renders a handful of shared pieces. Through the package barrels
// it loaded all of @plainva/ui and @plainva/core — which is why this file
// needed a 90-second hook (Befunde 2026-09-24, Z2; the phone's
// CommentsScreen.test.tsx does the same). Both barrels are replaced by exactly
// the modules the overview takes from them, the real ones. A new import there
// fails here with vitest's "No … export is defined on the mock"; one line
// below fixes it.
vi.mock("@plainva/core", async () => ({
  ...(await import("../../../../../packages/core/src/comments/legacyCommentImport")),
  ...(await import("../../../../../packages/core/src/workspace/commentAnchor")),
}));
vi.mock("@plainva/ui", async () => ({
  ...(await import("../../../../../packages/ui/src/components/CommentLegacyLock")),
  ...(await import("../../../../../packages/ui/src/components/CommentProvenance")),
  ...(await import("../../../../../packages/ui/src/components/ui/Button")),
  ...(await import("../../../../../packages/ui/src/components/ui/EmptyState")),
  ...(await import("../../../../../packages/ui/src/components/ui/Segmented")),
  ...(await import("../../../../../packages/ui/src/lib/commentAuthor")),
  ...(await import("../../../../../packages/ui/src/lib/commentJump")),
  ...(await import("../../../../../packages/ui/src/lib/commentMentions")),
  ...(await import("../../../../../packages/ui/src/lib/commentOverviewFocus")),
  ...(await import("../../../../../packages/ui/src/lib/commentThreads")),
  ...(await import("../../../../../packages/ui/src/lib/iconSizes")),
  ...(await import("../../../../../packages/ui/src/lib/noteTitle")),
}));

/**
 * The overview, locked on this device (Nachschaerfung, N3).
 *
 * Before N3 a locked device saw the plain "no open comments" - a list that
 * reads as "nobody is waiting for me" when the truth is "this device cannot
 * read the remarks yet". The view has to say that and offer the way out; the
 * unlock request goes out with `force`, so a prompt dismissed earlier in the
 * session comes back for a person who asked for it.
 */
describe("the comments overview, locked", () => {
  it("explains, offers the unlock, and asks for the prompt by force", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<CommentsOverview onOpenPath={() => {}} />); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(tr("comments.commentsLocked"));
    expect(host.textContent).not.toContain(tr("comments.commentOverviewNone"));

    const requests: Array<{ vaultPath?: string; force?: boolean }> = [];
    const onLocked = (e: Event) => requests.push((e as CustomEvent).detail);
    window.addEventListener("plainva-encryption-locked", onLocked);
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    window.removeEventListener("plainva-encryption-locked", onLocked);
    expect(requests).toEqual([{ vaultPath: "/v", force: true }]);

    await act(async () => { root.unmount(); });
    host.remove();
  });

  it("shows the plain empty state again once the device is unlocked", async () => {
    (vaultValues.getCommentStoreState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ mode: "plain", hasOutbox: false });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<CommentsOverview onOpenPath={() => {}} />); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(tr("comments.commentOverviewNone"));
    expect(host.querySelector('[data-testid="comments-unlock"]')).toBeNull();
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
