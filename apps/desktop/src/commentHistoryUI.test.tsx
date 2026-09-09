// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceCommentsColumn } from "./components/workspace/WorkspaceCommentsColumn";
import { CommentsSheet } from "../../mobile/src/components/CommentsSheet";
import type { WorkspaceCommentRecord } from "@plainva/core";
import { buildCommentThreads, groupSuggestionRounds, planCommentNotifications, renderNoteExport } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const value = key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});
const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function historical(): WorkspaceCommentRecord {
  return { commentId: "ab".repeat(16), targetObjectId: "cd".repeat(16), authorMemberId: "manager", authorDeviceId: "new-device",
    createdAt: "2026-09-09T09:00:00.000Z", body: "Historical comment", anchor: null, suggestion: null, parentCommentId: null, resolvedAt: null, resolvedCommentId: null,
    legacyOrigin: { format: "plainva-comments", version: 1, workspaceId: "aa".repeat(16), authorName: "Original writer",
      record: { commentId: "bb".repeat(16), path: "note.md", authorDeviceId: "old-device", createdAt: "2026-09-01T09:00:00.000Z",
        body: "Historical comment", parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null, suggestion: null, anchor: null } },
  };
}
async function mount(shell: "desktop" | "mobile", comment: WorkspaceCommentRecord | null, options: { legacyLocked?: { onUnlock(): void }; locked?: { onUnlock(): void; workspace?: boolean } } = {}) {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); mounted.push({ root, host });
  const callbacks = { onRetryPending: vi.fn(), onDiscardPending: vi.fn(), onDelete: vi.fn() };
  const props = { comments: comment ? [comment] : [], memberNames: new Map([["manager", "Importer"]]), selfMemberId: "manager", canComment: true, canWrite: true,
    onSubmit: vi.fn(async () => {}), onResolve: vi.fn(), onReviewDecision: vi.fn(), onApplySuggestion: vi.fn(), onDeclineSuggestion: vi.fn(), onPromoteToTask: vi.fn(), onRevealAnchor: vi.fn(), onClose: vi.fn(), ...callbacks, ...options };
  await act(async () => { root.render(shell === "desktop"
    ? <WorkspaceCommentsColumn {...props} resolutions={new Map()} activeCommentId={null} selectionQuote={null} onSelect={() => {}} />
    : <CommentsSheet {...props} />); });
  return { host, ...callbacks };
}
function buttons(host: HTMLElement) { return [...host.querySelectorAll("button")]; }

describe.each(["desktop", "mobile"] as const)("%s historical comment surface", shell => {
  it("names security settings for a locked workspace and suppresses the composer", async () => {
    const onUnlock = vi.fn(), { host } = await mount(shell, null, { locked: { onUnlock, workspace: true } });
    expect(host.textContent).toContain(en.comments.workspaceLocked);
    expect(host.textContent).not.toContain(en.comments.commentsLocked);
    expect(host.querySelector("textarea")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    expect(onUnlock).toHaveBeenCalledOnce();
  });
  it("keeps original authorship and timestamp separate from the importing member", async () => {
    const { host } = await mount(shell, historical());
    expect(host.textContent).toContain("Original writer"); expect(host.textContent).toContain(en.comments.legacyOrigin);
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-01T09:00:00.000Z");
    expect(host.querySelector(".pv-comment-card__name")?.textContent).not.toBe(en.comments.commentAuthorYou);
    expect(buttons(host).some(button => button.getAttribute("aria-label") === en.comments.commentDelete)).toBe(false);
  });
  it("keeps an unassigned original visible without reply or decision controls", async () => {
    const { host } = await mount(shell, { ...historical(), legacyPending: true });
    expect(host.textContent).toContain("Historical comment"); expect(host.textContent).toContain(en.comments.legacyImportPending);
    for (const label of [en.comments.commentReply, en.comments.suggestionApply, en.comments.suggestionDecline, en.workspaceSecurity.resolve])
      expect(buttons(host).some(button => button.textContent?.trim() === label)).toBe(false);
    expect(host.querySelector("textarea")).not.toBeNull();
  });
  it.each([false, true])("retries the actual queued ID and only offers discard for a new comment (historical: %s)", async imported => {
    const comment = historical(); if (!imported) delete comment.legacyOrigin;
    comment.pending = { outboxId: "queued-id", attempts: 1, lastError: "Network unavailable" };
    const { host, onRetryPending, onDiscardPending } = await mount(shell, comment);
    expect(host.textContent).toContain("Network unavailable");
    await act(async () => { buttons(host).find(button => button.textContent?.trim() === en.comments.commentSendRetry)!.click(); });
    expect(onRetryPending).toHaveBeenCalledWith("queued-id");
    const discard = buttons(host).find(button => button.textContent?.trim() === en.comments.commentSendDiscard);
    if (imported) expect(discard).toBeUndefined();
    else { await act(async () => discard!.click()); expect(onDiscardPending).toHaveBeenCalledWith("queued-id"); }
  });
  it("offers the older history's unlock without hiding the new-comment composer", async () => {
    const onUnlock = vi.fn(), { host } = await mount(shell, null, { legacyLocked: { onUnlock } });
    expect(host.textContent).toContain(en.comments.legacyHistoryLocked); expect(host.querySelector("textarea")).not.toBeNull();
    await act(async () => buttons(host).find(button => button.textContent?.trim() === en.comments.commentsUnlock)!.click());
    expect(onUnlock).toHaveBeenCalledOnce();
  });
});

it("exports the original name and date and keeps proposal rounds on the historical clock", () => {
  const old = historical(), names = new Map([["manager", "Importer"]]);
  const exported = renderNoteExport({ raw: "Original note.", comments: [old], names, mode: "appendix", formatDate: value => value });
  expect(exported.text).toContain("Original writer · 2026-09-01T09:00:00.000Z");
  expect(exported.text).not.toContain("Importer");
  const proposal = { ...old, suggestionBatchId: "old-round", suggestion: { replacement: "New wording", appliedAt: null, appliedBy: null, declinedAt: null } };
  const round = groupSuggestionRounds(buildCommentThreads([proposal], "manager", names)).rounds[0];
  expect(round.createdAt).toBe(old.legacyOrigin!.record.createdAt); expect(round.authorMemberId).toBe("legacy:old-device");
});

it("does not notify imports again or treat the importer as a historical thread participant", () => {
  const old = historical(), names = new Map([["manager", "Importer"]]);
  const base = { notes: [{ path: "note.md", comments: [old] }], names, seen: new Set<string>(), selfMemberId: "manager", selfDeviceId: "new-device" };
  expect(planCommentNotifications({ ...base, level: "all" })).toEqual({ kind: "none", seen: [old.commentId] });
  const reply = { ...old, commentId: "ee".repeat(16), body: "New reply", parentCommentId: old.commentId, authorMemberId: "another", authorDeviceId: "another-device", legacyOrigin: undefined };
  const updated = { ...base, notes: [{ path: "note.md", comments: [old, reply] }], seen: new Set([old.commentId]) };
  expect(planCommentNotifications({ ...updated, level: "relevant" }).kind).toBe("none");
  expect(planCommentNotifications({ ...updated, level: "all" })).toMatchObject({ kind: "single", notice: { commentId: reply.commentId } });
});
