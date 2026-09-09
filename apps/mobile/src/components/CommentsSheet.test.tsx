// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CommentsSheet } from "./CommentsSheet";
import type { WorkspaceCommentRecord } from "@plainva/core";
import en from "../../../../packages/ui/src/locales/en.json";

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

/**
 * Locked on this phone (Nachschaerfung, N3).
 *
 * Before N3 a locked device saw an empty sheet: "nobody wrote anything" was
 * the reading, and the composer was there to type into - a post would have
 * failed. The sheet has to say what is going on and offer the way out.
 */
describe("the comments sheet, locked", () => {
  it("shows conflicting decisions with the same explicit review action as desktop", async () => {
    const proposal: WorkspaceCommentRecord = { commentId: "ab".repeat(16), targetObjectId: "note.md", parentCommentId: null,
      authorMemberId: "phone", authorDeviceId: "phone", body: "Proposal", anchor: null, resolvedCommentId: null, resolvedAt: null,
      createdAt: "2026-09-09T10:00:00.000Z", suggestion: { replacement: "New words", appliedAt: null, appliedBy: null, declinedAt: null },
      suggestionDecision: { status: "conflict", decisions: [], knownIds: ["ac".repeat(16), "ad".repeat(16)] } };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    const onReviewDecision = vi.fn();
    await act(async () => { root.render(<CommentsSheet comments={[proposal]} memberNames={new Map([["phone", "Phone"]])} selfMemberId="phone"
      canComment canWrite onSubmit={async () => {}} onResolve={() => {}} onApplySuggestion={() => {}} onDeclineSuggestion={() => {}}
      onPromoteToTask={() => {}} onRevealAnchor={() => {}} onClose={() => {}} onReviewDecision={onReviewDecision} />); });
    const tabs = [...host.querySelectorAll("button")];
    await act(async () => { tabs.find((b) => b.textContent?.startsWith(tr("comments.suggestions")))!.click(); });
    expect(host.textContent).toContain(tr("comments.decisionConflict"));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.some((b) => b.textContent?.trim() === tr("comments.suggestionApply"))).toBe(false);
    await act(async () => { buttons.find((b) => b.textContent?.trim() === tr("comments.decisionReview"))!.click(); });
    expect(onReviewDecision).toHaveBeenCalledWith(proposal);
    await act(async () => { root.unmount(); }); host.remove();
  });

  it("explains, offers the unlock, and shows no composer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onUnlock = vi.fn();
    await act(async () => {
      root.render(
        <CommentsSheet
          comments={[]}
          memberNames={new Map()}
          selfMemberId="me"
          canComment
          canWrite
          onSubmit={async () => {}}
          onResolve={() => {}}
          onApplySuggestion={() => {}}
          onDeclineSuggestion={() => {}}
          onPromoteToTask={() => {}}
          onRevealAnchor={() => {}}
          onClose={() => {}}
          locked={{ onUnlock }}
        />,
      );
    });
    expect(host.textContent).toContain(tr("comments.commentsLocked"));
    expect(host.textContent).not.toContain(tr("comments.commentsNone"));
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
