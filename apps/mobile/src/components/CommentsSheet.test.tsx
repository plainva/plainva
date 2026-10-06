// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, type ReactElement } from "react";
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
  it("shows the owner's publication feedback and reviews only an applicable proposal with source rights", async () => {
    const comment: WorkspaceCommentRecord = { commentId: "91".repeat(16), targetObjectId: "92".repeat(16), parentCommentId: null,
      authorMemberId: "reviewer", authorDeviceId: "phone", body: "Please clarify", anchor: null, resolvedCommentId: null, resolvedAt: null,
      createdAt: "2026-09-15T08:00:00.000Z", suggestion: { replacement: "New words", appliedAt: null, appliedBy: null, declinedAt: null } };
    const entry = { comment, publicationId: "93".repeat(16), publicationName: "External review", path: "note.md", authorDisplayName: "Reviewer", authorActive: true, suggestionApplicable: true };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    const onApplySuggestion = vi.fn(), onDeclineSuggestion = vi.fn();
    const props = { comments: [], publicationComments: [entry], memberNames: new Map<string, string>(), selfMemberId: "owner",
      canComment: true, canWrite: true, onSubmit: async () => {}, onResolve: () => {}, onApplySuggestion, onDeclineSuggestion,
      onPromoteToTask: () => {}, onRevealAnchor: () => {}, onClose: () => {} };
    await act(async () => { root.render(<CommentsSheet {...props} />); });
    expect(host.textContent).toContain("External review");
    expect(host.textContent).toContain("Reviewer");
    expect(host.querySelector(".pv-comment-column__empty")).toBeNull();
    const section = host.querySelector(".pv-comment-returns")!;
    await act(async () => { [...section.querySelectorAll("button")].find(button => button.textContent === tr("comments.suggestionApply"))!.click(); });
    expect(onApplySuggestion).toHaveBeenCalledWith(comment);
    await act(async () => { root.render(<CommentsSheet {...props} publicationComments={[{ ...entry, suggestionApplicable: false }]} />); });
    expect([...section.querySelectorAll("button")].some(button => button.textContent === tr("comments.suggestionApply"))).toBe(false);
    await act(async () => { root.render(<CommentsSheet {...props} canWrite={false} canComment={false} />); });
    expect(section.querySelectorAll("button")).toHaveLength(0);
    await act(async () => { root.unmount(); }); host.remove();
  });
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

/**
 * The assistant in the threads (plan KI-Harness P3-6) — the sheet's side of
 * what the desktop column does: "@" offers it only where it can answer, the
 * thread it is answering says so and can be stopped, and what it wrote from
 * this phone is this phone's to delete.
 */
describe("the assistant in the sheet's threads (P3-6)", () => {
  const SELF = "phone";
  const AI_AUTHOR = "plainva-ai/m-1";
  const names = new Map<string, string>([["phone", "Marco"], ["laptop", "Anna"], [AI_AUTHOR, "Plainva AI · m-1"]]);
  const remark = (over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord => ({
    targetObjectId: "note.md", parentCommentId: null, authorMemberId: "laptop", authorDeviceId: "laptop", body: "-", anchor: null,
    resolvedCommentId: null, resolvedAt: null, createdAt: "2026-09-24T09:00:00.000Z", suggestion: null, ...over,
  });
  const base = { memberNames: names, selfMemberId: SELF, canComment: true, canWrite: true, onSubmit: async () => {}, onResolve: () => {},
    onApplySuggestion: () => {}, onDeclineSuggestion: () => {}, onPromoteToTask: () => {}, onRevealAnchor: () => {}, onClose: () => {} };

  async function mount(ui: ReactElement) {
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(ui); });
    return { host, root, unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); } };
  }
  /** Types into a controlled field the way a person does: the value, the caret, the input event. */
  async function type(field: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(field, value); field.setSelectionRange(value.length, value.length); field.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  const offeredNames = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.querySelector(".pv-menu-text")?.textContent);

  it("offers the assistant after an @ only where it can answer, and draws its mention either way", async () => {
    const asked = remark({ commentId: "q1", body: "@KI is that right?" });
    const off = await mount(<CommentsSheet {...base} comments={[asked]} />);
    const mention = off.host.querySelector(".pv-comment-card__mention")!;
    expect(mention.textContent).toBe("@KI");
    expect(mention.hasAttribute("data-tip")).toBe(false);
    const plain = off.host.querySelector(".pv-comment-compose textarea") as HTMLTextAreaElement;
    expect(plain.placeholder).toBe(tr("workspaceSecurity.addComment"));
    await type(plain, "@");
    expect(offeredNames()).toEqual(["Anna", "Marco"]);
    await off.unmount();

    const on = await mount(<CommentsSheet {...base} comments={[asked]} ai={{ label: "AI", replyingTo: null, stop: () => {} }} />);
    const field = on.host.querySelector(".pv-comment-compose textarea") as HTMLTextAreaElement;
    expect(field.placeholder).toBe(tr("ai.thread.composer"));
    await type(field, "@");
    expect(offeredNames()).toEqual(["AI", "Anna", "Marco"]);
    const row = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.querySelector(".pv-menu-text")?.textContent === "AI")!;
    expect(row.querySelector(".pv-menu-hint")?.textContent).toBe(tr("ai.thread.mentionHint"));
    await on.unmount();
  });

  it("shows which thread the assistant is answering, stops it from there, and lets this phone delete what it wrote", async () => {
    const asked = remark({ commentId: "t1", authorMemberId: SELF, authorDeviceId: SELF, body: "@AI is that right?" });
    const answer = remark({ commentId: "a1", parentCommentId: "t1", authorMemberId: AI_AUTHOR, authorDeviceId: SELF, body: "It is." });
    const foreign = remark({ commentId: "a2", parentCommentId: "t1", authorMemberId: AI_AUTHOR, authorDeviceId: "laptop", body: "From the laptop." });
    const other = remark({ commentId: "t2", body: "Something else." });
    const stop = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = await mount(<CommentsSheet {...base} comments={[asked, answer, foreign, other]} onDelete={onDelete} ai={{ label: "AI", replyingTo: "t1", stop }} />);

    const waiting = [...host.querySelectorAll("[data-testid=comment-ai-pending]")];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.closest(".pv-comment-card")?.textContent).toContain("@AI is that right?");
    await act(async () => { (host.querySelector("[data-testid=comment-ai-stop]") as HTMLElement).click(); });
    expect(stop).toHaveBeenCalledTimes(1);

    // The AI mark on what the assistant wrote; a delete control only on the reply this phone wrote.
    expect(host.querySelectorAll(".pv-comment-card__avatar[data-ai] svg")).toHaveLength(3);
    const replies = [...host.querySelectorAll(".pv-comment-card__reply")].filter((reply) => !reply.matches("[data-testid=comment-ai-pending]"));
    expect(replies.map((reply) => reply.querySelector(`button[aria-label="${tr("comments.commentDelete")}"]`) !== null)).toEqual([true, false]);
    await act(async () => { (replies[0]!.querySelector(`button[aria-label="${tr("comments.commentDelete")}"]`) as HTMLElement).click(); });
    await act(async () => { ([...host.querySelectorAll(".pv-comment-card__confirm button")].find((button) => button.textContent === tr("comments.commentDelete")) as HTMLElement).click(); });
    expect(onDelete).toHaveBeenCalledWith(answer);
    await unmount();
  });

  it("says why a remark could not be sent instead of leaving the draft without a word (finding 2026-10-06)", async () => {
    const { toast } = await import("@plainva/ui");
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0 as never);
    const { host, unmount } = await mount(<CommentsSheet {...base} comments={[]} onSubmit={async () => { throw new Error("comment-editor-unavailable"); }} />);
    const field = host.querySelector(".pv-comment-compose textarea") as HTMLTextAreaElement;
    await type(field, "A remark");
    await act(async () => { ([...host.querySelectorAll(".pv-comment-compose button")].find((button) => button.textContent?.includes(tr("workspaceSecurity.send"))) as HTMLElement).click(); });
    expect(error).toHaveBeenCalledWith("comment-editor-unavailable");
    // The draft is the person's text: it stays.
    expect(field.value).toBe("A remark");
    error.mockRestore();
    await unmount();
  });
});
