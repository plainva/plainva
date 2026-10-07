// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { buildCommentAnchor, type WorkspaceCommentAnchorResolution, type WorkspaceCommentRecord } from "@plainva/core";
import { suggestedProperties } from "@plainva/ui";

import { WorkspaceCommentsColumn, type PublicationCommentEntry } from "./WorkspaceCommentsColumn";
import en from "../../../../../packages/ui/src/locales/en.json";

/** The catalogue is nested; a key is a dotted path into it. */
function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

// Resolving through the REAL English catalogue, not echoing the key. Two things
// only become checkable that way: that every key this column asks for exists
// (a typo would render the bare key), and that the target sentence really
// carries a {{quote}} placeholder - without it the column would name no
// selection at all and still look fine.
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        // A counted string has a form per number; English has two.
        const value = lookup(typeof vars?.count === "number" && lookup(key) === key ? `${key}_${vars.count === 1 ? "one" : "other"}` : key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
      },
    }),
  };
});

/**
 * What the comment column must not get wrong.
 *
 * Every assertion below stands for something that fails SILENTLY: a reply that
 * disappears looks like it was never posted, an orphaned anchor that keeps
 * quiet looks like it still points somewhere, and a name that falls back to an
 * id fragment looks like a person nobody can identify - which is exactly the
 * design this column replaced.
 */
function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); }) };
}

const NOW = "2026-08-25T10:00:00.000Z";

function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "41".repeat(16), targetRevisionId: "42".repeat(16), parentCommentId: null,
    authorMemberId: "aabbccdd11223344", authorDeviceId: "de".repeat(16), operationHash: "ff".repeat(32),
    payloadHash: "ee".repeat(32), body: "-", anchor: null, createdAt: NOW,
    suggestion: null, resolvedCommentId: null, resolvedAt: null, ...over,
  } as WorkspaceCommentRecord;
}

const ANCHOR = { markerId: "7f3a", quote: "bis Ende des Jahres", before: "Der Vertrag laeuft ", after: ".", approximateOffset: 19 };
const SUGGESTION = { replacement: "bis zum 31.12.2026", appliedAt: null, appliedBy: null, declinedAt: null };
const NAMES = new Map([["aabbccdd11223344", "Marco"], ["9999888877776666", "Anna"]]);
const NO_RESOLUTIONS = new Map<string, WorkspaceCommentAnchorResolution>();

/** The head hides settled threads by default (K3); a test about them looks under "All". */
function showAll(host: HTMLElement) {
  act(() => { (host.querySelector("[data-testid=comment-filter-all]") as HTMLElement).click(); });
}

function props(over: Partial<React.ComponentProps<typeof WorkspaceCommentsColumn>> = {}) {
  return {
    comments: [], memberNames: NAMES, selfMemberId: null, resolutions: NO_RESOLUTIONS, canComment: true, canWrite: true,
    activeCommentId: null, selectionQuote: null,
    onSelect: vi.fn(), onSubmit: vi.fn(async () => {}), onResolve: vi.fn(),
    onApplySuggestion: vi.fn(), onDeclineSuggestion: vi.fn(),
    ...over,
  } as React.ComponentProps<typeof WorkspaceCommentsColumn>;
}

describe("workspace comment column", () => {
  it("keeps conflicting decisions open and offers a review instead of a direct verdict", () => {
    const proposal = comment({ commentId: "ab".repeat(16), anchor: ANCHOR, suggestion: SUGGESTION,
      suggestionDecision: { status: "conflict", decisions: [], knownIds: ["ac".repeat(16), "ad".repeat(16)] } });
    const onReviewDecision = vi.fn();
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [proposal], onReviewDecision })} />);
    act(() => { (host.querySelector('[data-testid="comment-kind-suggestions"]') as HTMLButtonElement).click(); });
    expect(host.textContent).toContain(tr("comments.decisionConflict"));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.some((b) => b.textContent?.trim() === tr("comments.suggestionApply"))).toBe(false);
    expect(buttons.some((b) => b.textContent?.trim() === tr("comments.suggestionDecline"))).toBe(false);
    act(() => { buttons.find((b) => b.textContent?.trim() === tr("comments.decisionReview"))!.click(); });
    expect(onReviewDecision).toHaveBeenCalledWith(proposal);
    unmount();
  });

  it("hangs a reply off its thread instead of showing it as its own card", () => {
    const root = comment({ commentId: "aa".repeat(16), body: "Welches Jahr?" });
    const reply = comment({ commentId: "bb".repeat(16), parentCommentId: root.commentId, body: "2027." });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [root, reply] })} />);
    expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(1);
    const replies = host.querySelectorAll(".pv-comment-card__reply");
    expect(replies).toHaveLength(1);
    expect(replies[0].textContent).toContain("2027.");
    unmount();
  });

  it("still shows a reply whose thread root has not synced yet", () => {
    // Partial sync is the normal state on a second device. Hiding the reply
    // until its root arrives would look like the reply was lost.
    const orphanReply = comment({ commentId: "bb".repeat(16), parentCommentId: "cc".repeat(16), body: "Passt" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [orphanReply] })} />);
    expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(1);
    expect(host.textContent).toContain("Passt");
    unmount();
  });

  it("says when the commented passage moved or is gone, and stays quiet when it still fits", () => {
    const anchored = comment({ commentId: "aa".repeat(16), anchor: ANCHOR, body: "Welches Jahr?" });
    // "marker" and "quote" both land the comment safely - the first because the
    // marker pair survived, the second because the quote occurs exactly once.
    // Neither needs a word; only a guess ("moved") and a loss ("orphan") do.
    const cases: Array<[WorkspaceCommentAnchorResolution, string | null]> = [
      [{ status: "marker", from: 19, to: 38 }, null],
      [{ status: "quote", from: 19, to: 38 }, null],
      [{ status: "moved", from: 42, to: 61 }, "comments.commentAnchorMoved"],
      [{ status: "orphan" }, "comments.commentAnchorOrphan"],
    ];
    for (const [resolution, expected] of cases) {
      const resolutions = new Map([[anchored.commentId, resolution]]);
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [anchored], resolutions })} />);
      const state = host.querySelector(".pv-comment-card__state");
      expect(state?.textContent ?? null).toBe(expected === null ? null : tr(expected));
      // The quote is the anchor's own stored text - never a re-slice of the
      // current document, which may have changed since.
      expect(host.querySelector(".pv-comment-card__quote")?.textContent).toBe(ANCHOR.quote);
      unmount();
    }
  });

  it("names the author from the policy and keeps the member id reachable", () => {
    const known = comment({ commentId: "aa".repeat(16), body: "Von Marco" });
    const stranger = comment({ commentId: "bb".repeat(16), authorMemberId: "1234123412341234", body: "Von wem?" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [known, stranger] })} />);
    const metas = [...host.querySelectorAll(".pv-comment-card__name")];
    expect(metas[0].textContent).toContain("Marco");
    expect(metas[0].getAttribute("data-tip")).toBe("aabbccdd11223344");
    // A name is a claim the policy carries. Where it carries none, the column
    // says so in words - it does not print eight characters of an id.
    expect(metas[1].textContent).toContain(tr("comments.commentUnknownAuthor"));
    expect(metas[1].textContent).not.toContain("1234");
    unmount();
  });

  it("offers resolving until a thread is resolved, and then shows the state instead", () => {
    const open = comment({ commentId: "aa".repeat(16), body: "Offen" });
    const onResolve = vi.fn();
    const first = render(<WorkspaceCommentsColumn {...props({ comments: [open], onResolve })} />);
    const resolve = [...first.host.querySelectorAll("button")].find((b) => b.textContent?.trim() === tr("workspaceSecurity.resolve"));
    act(() => { resolve!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onResolve).toHaveBeenCalledWith(open.commentId);
    first.unmount();

    const done = comment({ commentId: "aa".repeat(16), body: "Offen", resolvedAt: NOW });
    const second = render(<WorkspaceCommentsColumn {...props({ comments: [done] })} />);
    showAll(second.host);
    expect(second.host.textContent).toContain(tr("workspaceSecurity.resolved"));
    expect([...second.host.querySelectorAll("button")].some((b) => b.textContent?.trim() === tr("workspaceSecurity.resolve"))).toBe(false);
    second.unmount();
  });

  it("names what a new comment would attach to", () => {
    // Once the caret sits in the text field the selection is no longer visible,
    // so the compose box has to say what it is about to anchor to.
    const withSelection = render(<WorkspaceCommentsColumn {...props({ selectionQuote: "bis Ende des Jahres" })} />);
    expect(withSelection.host.querySelector(".pv-comment-compose__target")?.textContent).toContain("bis Ende des Jahres");
    withSelection.unmount();

    const withoutSelection = render(<WorkspaceCommentsColumn {...props()} />);
    expect(withoutSelection.host.querySelector(".pv-comment-compose__target")?.textContent).toBe(tr("comments.commentOnNote"));
    withoutSelection.unmount();
  });

  it("shows a reader no compose box at all", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ canComment: false, comments: [comment({ commentId: "aa".repeat(16) })] })} />);
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    // The head's filter is the only control left; nothing that writes.
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    for (const key of ["send", "commentReply", "resolve", "commentToTask"]) expect(labels).not.toContain(tr(`workspaceSecurity.${key}`));
    unmount();
  });

  it("shows a suggestion as before and after, not as a sentence about the text", () => {
    // The whole point of a suggestion over a comment is that the reader does
    // not have to reconstruct the proposal from prose: the quoted passage is
    // struck through and what would replace it stands directly underneath.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, body: "zu vage", suggestion: SUGGESTION })],
    })} />);
    // One line, word by word (K5): what goes is struck, what comes is inserted.
    const diff = host.querySelector(".pv-comment-card__diff")!;
    expect([...diff.querySelectorAll("del")].map((d) => d.textContent).join("")).toBe("Ende des Jahres");
    expect([...diff.querySelectorAll("ins")].map((d) => d.textContent).join("")).toBe("zum 31.12.2026");
    expect(diff.textContent).toContain("bis ");
    unmount();
  });

  it("names a deletion instead of showing an empty line", () => {
    // An empty replacement is a proposal too - "remove this". Rendered as-is it
    // would be a blank strip that says nothing.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, suggestion: { replacement: "", appliedAt: null, appliedBy: null, declinedAt: null } })],
    })} />);
    expect(host.querySelector(".pv-comment-card__diff")?.textContent).toContain(tr("comments.suggestionDeletes"));
    unmount();
  });

  it("offers accepting only to someone who may write the note", () => {
    // Accepting swaps text in the note; declining only closes the thread. A
    // commenter therefore gets one of the two buttons, not both - and the one
    // they get must not be the one that writes.
    const open = comment({ commentId: "aa".repeat(16), anchor: ANCHOR, suggestion: SUGGESTION });
    const writer = render(<WorkspaceCommentsColumn {...props({ comments: [open] })} />);
    const writerLabels = [...writer.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(writerLabels).toContain(tr("comments.suggestionApply"));
    expect(writerLabels).toContain(tr("comments.suggestionDecline"));
    writer.unmount();

    const commenter = render(<WorkspaceCommentsColumn {...props({ comments: [open], canWrite: false })} />);
    const commenterLabels = [...commenter.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(commenterLabels).not.toContain(tr("comments.suggestionApply"));
    expect(commenterLabels).toContain(tr("comments.suggestionDecline"));
    commenter.unmount();
  });

  it("says which way a decided suggestion went", () => {
    // Accepting and declining both resolve the thread. The plain "resolved"
    // word would read the same either way and hide the one fact that matters.
    const applied = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, resolvedAt: NOW, suggestion: { ...SUGGESTION, appliedAt: NOW, appliedBy: "aabbccdd11223344" } })],
    })} />);
    showAll(applied.host);
    expect(applied.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("comments.suggestionApplied"));
    applied.unmount();

    const declined = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, resolvedAt: NOW, suggestion: { ...SUGGESTION, declinedAt: NOW } })],
    })} />);
    showAll(declined.host);
    expect(declined.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("comments.suggestionDeclined"));
    declined.unmount();
  });

  it("no longer offers to propose from the compose box - the suggestion mode does that (V4)", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ selectionQuote: "bis Ende des Jahres" })} />);
    expect(host.querySelector(".pv-comment-compose__replacement")).toBeNull();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain(tr("workspaceSecurity.send"));
    unmount();
  });
  it("marks a thread that names you and lifts it to the top", () => {
    // A mention exists to pull attention. A card that carries the name but
    // sits fourth in the column has done nothing the writer intended.
    const other = comment({ commentId: "aa".repeat(16), body: "Nur eine Notiz" });
    const forMe = comment({ commentId: "bb".repeat(16), body: "Bitte @Anna schauen" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [other, forMe], selfMemberId: "9999888877776666",
    })} />);
    const cards = [...host.querySelectorAll(".pv-comment-card")];
    expect(cards[0].textContent).toContain("Bitte @Anna schauen");
    expect(cards[0].querySelector(".pv-comment-card__state")?.textContent).toContain(tr("comments.commentMentionsYou"));
    // ...and the other card keeps quiet, or the badge would say nothing.
    expect(cards[1].querySelector(".pv-comment-card__state")).toBeNull();
    unmount();
  });

  it("counts a mention in a reply, not just in the first comment", () => {
    const root = comment({ commentId: "aa".repeat(16), body: "Wer weiss das?" });
    const reply = comment({ commentId: "bb".repeat(16), parentCommentId: root.commentId, body: "@Anna weiss es" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [root, reply], selfMemberId: "9999888877776666",
    })} />);
    expect(host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("comments.commentMentionsYou"));
    unmount();
  });

  it("leaves a resolved thread where it is, even when it names you", () => {
    // Resolved means it needs no attention any more. Floating it would push
    // the open threads down for nothing.
    const open = comment({ commentId: "aa".repeat(16), body: "Offen" });
    const done = comment({ commentId: "bb".repeat(16), body: "@Anna, erledigt", resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [open, done], selfMemberId: "9999888877776666",
    })} />);
    const cards = [...host.querySelectorAll(".pv-comment-card")];
    expect(cards[0].textContent).toContain("Offen");
    expect(host.textContent).not.toContain(tr("comments.commentMentionsYou"));
    unmount();
  });

  it("claims nothing while this device cannot say who it is", () => {
    const forSomeone = comment({ commentId: "aa".repeat(16), body: "Bitte @Anna schauen" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [forSomeone] })} />);
    expect(host.textContent).not.toContain(tr("comments.commentMentionsYou"));
    unmount();
  });

  it("lifts @Name out of the body without changing a character of it", () => {
    const body = "Bitte @Anna und @Niemand schauen";
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), body })],
    })} />);
    const rendered = host.querySelector(".pv-comment-card__body");
    // The text is what the file says - the highlight is the only difference.
    expect(rendered?.textContent).toBe(body);
    const mentions = [...host.querySelectorAll(".pv-comment-card__mention")];
    expect(mentions.map((m) => m.textContent)).toEqual(["@Anna"]);
    // The id rides along so an ambiguous name is still identifiable on hover.
    expect(mentions[0].getAttribute("data-tip")).toBe("9999888877776666");
    unmount();
  });

  /**
   * What came back from a publication (D7).
   *
   * The returns are the one place in this column where a card must NOT offer
   * what every other card offers: a reply, a resolve, an apply. Each of those
   * would write into another workspace, and a button that looked like the ones
   * above would promise an answer that never arrives.
   */
  describe("returns from a publication", () => {
    it("reviews an exact publication suggestion in the source through the existing decision callbacks", () => {
      const entry = incoming({ comment: comment({ commentId: "80".repeat(16), body: "Review", anchor: ANCHOR, suggestion: SUGGESTION }), suggestionApplicable: true });
      const onApplySuggestion = vi.fn(), onDeclineSuggestion = vi.fn();
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [entry], onApplySuggestion, onDeclineSuggestion })} />);
      const section = host.querySelector(".pv-comment-returns")!;
      const buttons = [...section.querySelectorAll("button")];
      act(() => buttons.find(button => button.textContent === tr("comments.suggestionApply"))!.click());
      act(() => buttons.find(button => button.textContent === tr("comments.suggestionDecline"))!.click());
      expect(onApplySuggestion).toHaveBeenCalledWith(entry.comment);
      expect(onDeclineSuggestion).toHaveBeenCalledWith(entry.comment);
      expect(section.textContent).toContain(tr("comments.publicationReviewLocal"));
      unmount();
      const readOnly = render(<WorkspaceCommentsColumn {...props({ publicationComments: [entry], canWrite: false, canComment: false })} />);
      expect(readOnly.host.querySelector(".pv-comment-returns")!.querySelectorAll("button")).toHaveLength(0);
      readOnly.unmount();
    });
    // The prop's type is `readonly Entry[] | undefined`, and a union does not
    // match `readonly (infer E)[]` - inferring the element back out of it
    // silently yields `never`. The column exports the element type; take it.
    function incoming(over: Partial<PublicationCommentEntry> = {}): PublicationCommentEntry {
      return {
        comment: comment({ commentId: "77".repeat(16), body: "Bitte praezisieren" }),
        publicationId: "11".repeat(16), publicationName: "Beirat Q3", path: "Notiz.md",
        authorDisplayName: "Dr. Weber", authorActive: true, suggestionApplicable: false,
        ...over,
      } as PublicationCommentEntry;
    }

    it("names the publication and the recipient, and offers nothing to answer with", () => {
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [incoming()] })} />);
      const section = host.querySelector(".pv-comment-returns");
      expect(section?.textContent).toContain("Beirat Q3");
      // The name comes from the publication's OWN policy - this vault's member
      // list does not contain this person at all, so a lookup there would print
      // "Unknown member" over a perfectly well-known recipient.
      expect(section?.textContent).toContain("Dr. Weber");
      expect(section?.textContent).toContain("Bitte praezisieren");
      // Not a single control: every one of them would be a write into the
      // publication, which this side cannot do from here.
      expect(section?.querySelectorAll("button")).toHaveLength(0);
      unmount();
    });

    it("keeps the returns out of the vault's own thread list", () => {
      // One card in the column proper would mean the remark had been made in
      // THIS vault - it was not, and mixing the two would misstate where it
      // came from and who can act on it.
      const own = comment({ commentId: "aa".repeat(16), body: "Intern" });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [own], publicationComments: [incoming()] })} />);
      const outside = host.querySelector(".pv-comment-returns");
      expect(outside).not.toBeNull();
      expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(2);
      expect(host.querySelectorAll(".pv-comment-card--incoming")).toHaveLength(1);
      expect(outside?.textContent).not.toContain("Intern");
      unmount();
    });

    it("does not claim the note has no comments when returns are the only thing on it", () => {
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [incoming()] })} />);
      expect(host.querySelector(".pv-comment-column__empty")).toBeNull();
      unmount();
    });

    it("says when the author lost access and when a suggestion cannot be applied", () => {
      const stale = incoming({
        authorActive: false,
        comment: comment({ commentId: "88".repeat(16), body: "Vorschlag", anchor: ANCHOR, suggestion: SUGGESTION }),
        suggestionApplicable: false,
      });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [stale] })} />);
      // Both are facts about the record, not failures: the remark stands, and
      // hiding either would rewrite what was actually said.
      expect(host.textContent).toContain(tr("workspaceSecurity.publicationCommentAuthorGone"));
      expect(host.textContent).toContain(tr("workspaceSecurity.publicationSuggestionStale"));
      // The proposed wording is still shown - a recipient wrote it, whether or
      // not this side can paste it in.
      expect([...host.querySelectorAll(".pv-comment-card__diff ins")].map((n) => n.textContent).join("")).toContain("zum 31.12.2026");
      unmount();
    });

    it("never threads a reply from one publication under a root from another", () => {
      // A comment id is only unique INSIDE its publication. Grouping first is
      // what keeps two recipients' threads from being stapled together.
      const a = incoming({ publicationId: "11".repeat(16), publicationName: "Beirat", comment: comment({ commentId: "99".repeat(16), body: "Erstes" }) });
      const b = incoming({
        publicationId: "22".repeat(16), publicationName: "Redaktion", authorDisplayName: "Frau Sun",
        comment: comment({ commentId: "aa".repeat(16), parentCommentId: "99".repeat(16), body: "Zweites" }),
      });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [a, b] })} />);
      expect(host.querySelectorAll(".pv-comment-returns")).toHaveLength(2);
      // Two roots, no nesting: the second is not a reply to the first.
      expect(host.querySelectorAll(".pv-comment-card--incoming")).toHaveLength(2);
      expect(host.querySelectorAll(".pv-comment-card__reply")).toHaveLength(0);
      unmount();
    });
  });
});

/**
 * A remark still in the outbox (K6, finding 2026-09-03): the card is there the
 * moment it was sent, says so, and once it failed offers retry and discard to
 * the person who wrote it - and nothing else, because reply/resolve/task would
 * queue behind a remark that may never land.
 */
describe("pending remarks (K6)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("shows a just-sent remark as sending, without the usual actions", () => {
    const pending = comment({ commentId: "c1", body: "On its way", pending: { outboxId: "o1", attempts: 0, lastError: null } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[pending]} />);
    try {
      expect(host.textContent).toContain("On its way");
      expect(host.textContent).toContain(tr("comments.commentSending"));
      expect(host.querySelector(".pv-comment-card.is-pending")).not.toBeNull();
      expect(host.textContent).not.toContain(tr("comments.commentReply"));
      expect(host.textContent).not.toContain(tr("workspaceSecurity.resolve"));
    } finally { unmount(); }
  });

  it("names the reason a remark was not sent and lets its author retry or discard it", () => {
    const onRetryPending = vi.fn();
    const onDiscardPending = vi.fn();
    const failed = comment({ commentId: "c2", body: "Stuck", pending: { outboxId: "o2", attempts: 3, lastError: "workspace-object-not-synced" } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[failed]} onRetryPending={onRetryPending} onDiscardPending={onDiscardPending} />);
    try {
      expect(host.textContent).toContain(tr("comments.commentSendFailed").replace("{{reason}}", "workspace-object-not-synced"));
      const buttons = [...host.querySelectorAll("button")];
      const retry = buttons.find((b) => b.textContent?.trim() === tr("comments.commentSendRetry"))!;
      const discard = buttons.find((b) => b.textContent?.trim() === tr("comments.commentSendDiscard"))!;
      act(() => { retry.click(); });
      act(() => { discard.click(); });
      expect(onRetryPending).toHaveBeenCalledWith("o2");
      expect(onDiscardPending).toHaveBeenCalledWith("o2");
    } finally { unmount(); }
  });

  it("offers neither retry nor discard on somebody else's stuck remark", () => {
    const failed = comment({ commentId: "c3", body: "Theirs", authorMemberId: "9999888877776666", pending: { outboxId: "o3", attempts: 1, lastError: "x" } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[failed]} onRetryPending={() => {}} onDiscardPending={() => {}} />);
    try {
      expect(host.textContent).not.toContain(tr("comments.commentSendRetry"));
    } finally { unmount(); }
  });
});

/**
 * The column's head (K3): the open count, the Open/All filter, the close
 * button, and the who-and-when line on every card.
 */
describe("column head and card head (K3)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("counts open threads, hides resolved ones by default and shows them under All", () => {
    const open = comment({ commentId: "o1", body: "Still open" });
    const done = comment({ commentId: "d1", body: "Settled", resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[open, done]} />);
    try {
      expect(host.querySelector("[data-testid=comment-open-count]")?.textContent).toBe(tr("comments.commentOpenCount").replace("{{n}}", "1"));
      expect(host.textContent).toContain("Still open");
      expect(host.textContent).not.toContain("Settled");
      act(() => { (host.querySelector("[data-testid=comment-filter-all]") as HTMLElement).click(); });
      expect(host.textContent).toContain("Settled");
    } finally { unmount(); }
  });

  it("closes through the head and names author and time on the card", () => {
    const onClose = vi.fn();
    const c = comment({ commentId: "c1", body: "Hello", authorMemberId: "9999888877776666" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[c]} onClose={onClose} />);
    try {
      expect(host.querySelector(".pv-comment-card__avatar")?.textContent).toBe("AN");
      expect(host.querySelector(".pv-comment-card__name")?.textContent).toBe("Anna");
      expect(host.querySelector("time.pv-comment-card__when")?.getAttribute("dateTime")).toBe(NOW);
      act(() => { (host.querySelector("[data-testid=comment-column-close]") as HTMLElement).click(); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
});

/**
 * Deleting (K7): offered to the author and to a moderator, asked IN the card,
 * and only then handed out.
 */
describe("deleting a remark (K7)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("asks first and then hands the author's remark to onDelete", () => {
    const onDelete = vi.fn();
    const mine = comment({ commentId: "m1", body: "Mine" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[mine]} onDelete={onDelete} />);
    try {
      act(() => { (host.querySelector("[data-testid=comment-delete-m1]") as HTMLElement).click(); });
      expect(host.querySelector(".pv-comment-card__confirm")?.textContent).toContain(tr("comments.commentDeleteConfirm"));
      expect(onDelete).not.toHaveBeenCalled();
      act(() => { (host.querySelector("[data-testid=comment-delete-confirm]") as HTMLElement).click(); });
      expect(onDelete).toHaveBeenCalledWith(mine);
      expect(host.querySelector(".pv-comment-card__confirm")).toBeNull();
    } finally { unmount(); }
  });

  it("offers a stranger's remark only to a moderator, and names the replies it takes along", () => {
    const theirs = comment({ commentId: "t1", body: "Theirs", authorMemberId: "9999888877776666" });
    const reply = comment({ commentId: "r1", body: "Mine under theirs", parentCommentId: "t1" });
    const plain = render(<WorkspaceCommentsColumn {...baseProps} comments={[theirs, reply]} onDelete={() => {}} />);
    try {
      expect(plain.host.querySelector("[data-testid=comment-delete-t1]")).toBeNull();
      // The reply is mine, so it carries its own control.
      expect(plain.host.querySelector("[data-testid=comment-delete-r1]")).not.toBeNull();
    } finally { plain.unmount(); }
    const moderator = render(<WorkspaceCommentsColumn {...baseProps} comments={[theirs, reply]} onDelete={() => {}} canModerate />);
    try {
      act(() => { (moderator.host.querySelector("[data-testid=comment-delete-t1]") as HTMLElement).click(); });
      expect(moderator.host.querySelector(".pv-comment-card__confirm")?.textContent).toContain(tr("comments.commentDeleteConfirmThread"));
    } finally { moderator.unmount(); }
  });
});

/**
 * A proposal round in the column (V3): its blocks stay together under the
 * author and the round's sentence, and one control decides all of them.
 */
describe("proposal rounds (V3)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("groups the blocks of a round and hands the whole round to onApplyRound", () => {
    const onApplyRound = vi.fn();
    const block = (id: string, index: number, over: Partial<WorkspaceCommentRecord> = {}) =>
      comment({ commentId: id, anchor: ANCHOR, suggestion: SUGGESTION, suggestionBatchId: "ab".repeat(16), batchIndex: index, batchNote: "From the PDF", authorMemberId: "9999888877776666", ...over });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[block("b1", 0), block("b2", 1)]} onApplyRound={onApplyRound} />);
    try {
      act(() => { (host.querySelector("[data-testid=comment-kind-suggestions]") as HTMLElement).click(); });
      const round = host.querySelector(".pv-comment-round")!;
      expect(round.textContent).toContain("From the PDF");
      expect(round.textContent).toContain(tr("comments.suggestRoundCount_other").replace("{{count}}", "2"));
      expect(round.querySelectorAll(".pv-comment-card")).toHaveLength(2);
      act(() => { (host.querySelector("[data-testid=round-apply-" + "ab".repeat(16) + "]") as HTMLElement).click(); });
      expect(onApplyRound).toHaveBeenCalledWith("ab".repeat(16));
    } finally { unmount(); }
  });
});

describe("a card named from the text (finding 2026-09-03)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };
  const remark = comment({ commentId: "r1", body: "A remark", anchor: ANCHOR });
  const proposal = comment({ commentId: "p1", anchor: ANCHOR, suggestion: SUGGESTION, authorMemberId: "9999888877776666" });

  it("switches to the proposals tab when the named card is a proposal, and back for a remark", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, proposal]} activeCommentId="p1" />);
    try {
      // The column opened on "Comments" (a remark is open) - the pick wins.
      expect(host.querySelector(".pv-comment-round")).not.toBeNull();
      expect(host.querySelector(".pv-comment-round .pv-comment-card.is-active")).not.toBeNull();
    } finally { unmount(); }
    const back = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, proposal]} activeCommentId="r1" />);
    try {
      expect(back.host.querySelector(".pv-comment-round")).toBeNull();
      expect(back.host.querySelector(".pv-comment-card.is-active")?.textContent).toContain("A remark");
    } finally { back.unmount(); }
  });

  it("brings a settled thread back under 'all' when it is the one named", () => {
    const settled = comment({ commentId: "s1", body: "Done long ago", anchor: ANCHOR, resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, settled]} activeCommentId="s1" />);
    try {
      expect(host.querySelector(".pv-comment-card.is-active")?.textContent).toContain("Done long ago");
    } finally { unmount(); }
  });
});

describe("locked on this device (N3)", () => {
  it("explains, offers the unlock, and shows no composer - instead of an empty list", async () => {
    const onUnlock = vi.fn();
    const { host, unmount } = render(
      <WorkspaceCommentsColumn
        comments={[]}
        memberNames={new Map()}
        selfMemberId="me"
        resolutions={new Map()}
        canComment
        canWrite
        activeCommentId={null}
        selectionQuote={null}
        onSelect={() => {}}
        onSubmit={async () => {}}
        onResolve={() => {}}
        onApplySuggestion={() => {}}
        onDeclineSuggestion={() => {}}
        onPromoteToTask={() => {}}
        locked={{ onUnlock }}
      />,
    );
    expect(host.textContent).toContain(tr("comments.commentsLocked"));
    expect(host.textContent).not.toContain(tr("comments.commentsNone"));
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("the byline (finding 2026-09-09)", () => {
  it("says 'you' for the reader's own remark and names an unnamed device honestly", () => {
    const own = comment({ commentId: "01".repeat(16), authorMemberId: "laptop", body: "mine" });
    // An open-path record carries no revision.
    const theirs = { ...comment({ commentId: "02".repeat(16), authorMemberId: "phone", body: "theirs" }), targetRevisionId: undefined } as WorkspaceCommentRecord;
    const { host, unmount } = render(
      <WorkspaceCommentsColumn
        comments={[own, theirs]}
        memberNames={new Map()}
        selfMemberId="laptop"
        resolutions={NO_RESOLUTIONS}
        canComment
        canWrite
        activeCommentId={null}
        selectionQuote={null}
        onSelect={() => {}}
        onSubmit={async () => {}}
        onResolve={() => {}}
        onApplySuggestion={() => {}}
        onDeclineSuggestion={() => {}}
        onPromoteToTask={() => {}}
      />,
    );
    expect(host.textContent).toContain(tr("comments.commentAuthorYou"));
    expect(host.textContent).toContain(tr("comments.commentUnnamedDevice"));
    expect(host.textContent).not.toContain(tr("comments.commentUnknownAuthor"));
    unmount();
  });
});

/**
 * The assistant in the threads (plan KI-Harness P3-6).
 *
 * What has to hold on both shells: "@" offers the assistant only where it can
 * answer, a mention written elsewhere is drawn as one regardless, the thread
 * it is answering says so and can be stopped, and what it wrote from this
 * device is this device's to delete.
 */
describe("the assistant in the threads (P3-6)", () => {
  const SELF = "de".repeat(16);
  const AI_AUTHOR = "plainva-ai/m-1";
  const names = new Map<string, string>([...NAMES, [AI_AUTHOR, "Plainva AI · m-1"]]);
  const assistant = (over: Partial<{ label: string; replyingTo: string | null; stop: () => void }> = {}) => ({ label: "AI", replyingTo: null, stop: vi.fn(), ...over });

  /** Types into a controlled field the way a person does: the value, the caret, the input event. */
  function type(field: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(field, value);
      field.setSelectionRange(value.length, value.length);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const offeredNames = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.querySelector(".pv-menu-text")?.textContent);

  it("draws a mention of the assistant in every spelling, without an id behind it", () => {
    const asked = comment({ commentId: "q1", body: "@KI is that right, @Anna?" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [asked], memberNames: names })} />);
    const mentions = [...host.querySelectorAll(".pv-comment-card__mention")];
    expect(mentions.map((mention) => mention.textContent)).toEqual(["@KI", "@Anna"]);
    // A person's mention names the id behind the name; the assistant has none to show.
    expect(mentions.map((mention) => mention.getAttribute("data-tip"))).toEqual([null, "9999888877776666"]);
    unmount();
  });

  it("offers the assistant after an @ only where it can answer, and never one of its bylines", () => {
    const off = render(<WorkspaceCommentsColumn {...props({ memberNames: names })} />);
    const plain = off.host.querySelector(".pv-comment-compose--new textarea") as HTMLTextAreaElement;
    expect(plain.placeholder).toBe(tr("workspaceSecurity.addComment"));
    type(plain, "@");
    expect(offeredNames()).toEqual(["Anna", "Marco"]);
    off.unmount();

    const on = render(<WorkspaceCommentsColumn {...props({ memberNames: names, ai: assistant() })} />);
    const field = on.host.querySelector(".pv-comment-compose--new textarea") as HTMLTextAreaElement;
    expect(field.placeholder).toBe(tr("ai.thread.composer"));
    type(field, "@");
    expect(offeredNames()).toEqual(["AI", "Anna", "Marco"]);
    // It is not a person: the row carries the AI mark and says what picking it does.
    const row = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.querySelector(".pv-menu-text")?.textContent === "AI")!;
    expect(row.querySelector(".pv-menu-ic svg")).not.toBeNull();
    expect(row.querySelector(".pv-menu-hint")?.textContent).toBe(tr("ai.thread.mentionHint"));
    on.unmount();
  });

  it("shows which thread the assistant is answering, and stops it from there", () => {
    const first = comment({ commentId: "t1", body: "@AI is that right?" });
    const other = comment({ commentId: "t2", body: "Something else." });
    const stop = vi.fn();
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [first, other], memberNames: names, ai: assistant({ replyingTo: "t1", stop }) })} />);
    const waiting = [...host.querySelectorAll("[data-testid=comment-ai-pending]")];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.closest(".pv-comment-card")?.textContent).toContain("@AI is that right?");
    expect(waiting[0]!.textContent).toContain(tr("ai.thread.replying"));
    act(() => { (host.querySelector("[data-testid=comment-ai-stop]") as HTMLElement).click(); });
    expect(stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("marks what the assistant wrote and lets the device that wrote it delete it", () => {
    const asked = comment({ commentId: "t1", authorMemberId: SELF, authorDeviceId: SELF, body: "@AI is that right?" });
    const answer = comment({ commentId: "a1", parentCommentId: "t1", authorMemberId: AI_AUTHOR, authorDeviceId: SELF, body: "It is." });
    const foreign = comment({ commentId: "a2", parentCommentId: "t1", authorMemberId: AI_AUTHOR, authorDeviceId: "9999888877776666", body: "From another device." });
    const onDelete = vi.fn();
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [asked, answer, foreign], memberNames: names, selfMemberId: SELF, onDelete })} />);
    try {
      // The AI mark instead of two letters of a model's name, in the app's own colour pair.
      const marks = [...host.querySelectorAll(".pv-comment-card__avatar[data-ai]")];
      expect(marks).toHaveLength(2);
      expect(marks.every((mark) => mark.querySelector("svg") && !mark.hasAttribute("data-hue"))).toBe(true);
      expect(host.textContent).toContain("Plainva AI · m-1");
      // Written from this device: this device may delete it. Another device's is not ours to take back.
      expect(host.querySelector("[data-testid=comment-delete-a1]")).not.toBeNull();
      expect(host.querySelector("[data-testid=comment-delete-a2]")).toBeNull();
      act(() => { (host.querySelector("[data-testid=comment-delete-a1]") as HTMLElement).click(); });
      act(() => { (host.querySelector("[data-testid=comment-delete-confirm]") as HTMLElement).click(); });
      expect(onDelete).toHaveBeenCalledWith(answer);
    } finally { unmount(); }
  });

  it("marks what another program wrote as a machine's: no person's letters, and not the assistant's mark", () => {
    // An AI app at Plainva's MCP server and an external agent sign with ids of their own (ADR 0023).
    const APP = "mcp:3f9a1c2b4d5e6f70";
    const AGENT = "acp:helper";
    const byApp = comment({ commentId: "p1", authorMemberId: APP, authorDeviceId: SELF, body: "From an app." });
    const byAgent = comment({ commentId: "p2", authorMemberId: AGENT, authorDeviceId: "9999888877776666", body: "From an agent on another device." });
    const signed = new Map<string, string>([...names, [APP, "Claude Code (AI app)"], [AGENT, "Helper (external agent)"]]);
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [byApp, byAgent], memberNames: signed, selfMemberId: SELF, onDelete: vi.fn() })} />);
    try {
      const marks = [...host.querySelectorAll(".pv-comment-card__avatar[data-machine]")];
      expect(marks).toHaveLength(2);
      expect(marks.every((mark) => mark.querySelector("svg") && !mark.hasAttribute("data-hue") && !mark.hasAttribute("data-ai"))).toBe(true);
      expect(host.textContent).toContain("Claude Code (AI app)");
      expect(host.textContent).toContain("Helper (external agent)");
      // What came through this device is this device's to delete; what another device let in is not.
      expect(host.querySelector("[data-testid=comment-delete-p1]")).not.toBeNull();
      expect(host.querySelector("[data-testid=comment-delete-p2]")).toBeNull();
    } finally { unmount(); }
  });
});

/**
 * A suggestion that proposes the value of a property (plan KI-Harness P5-3).
 *
 * Underneath it is a passage like every other suggestion — the property's
 * entry in the note's properties —, so the card would work without knowing
 * any of this. What it would show then is a line of YAML, and what it would
 * not say is that the property has moved on since: a suggestion whose entry is
 * gone looks exactly like one that still fits.
 */
describe("a suggestion that proposes a property (P5-3)", () => {
  const BRIEF = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nShort.\n";
  /** A proposal made against BRIEF: the passage it replaces, and the hint where it replaces a property's entry. */
  const proposal = (commentId: string, from: number, to: number, replacement: string, key?: string, over: Partial<WorkspaceCommentRecord> = {}) =>
    comment({ commentId, anchor: buildCommentAnchor(BRIEF, from, to, "7f3a", key ? { kind: "property", key } : undefined), suggestion: { replacement, appliedAt: null, appliedBy: null, declinedAt: null }, ...over });
  /** The column as the editor mounts it: with what the suggestions of this note propose, read against the note as it is. */
  const column = (comments: WorkspaceCommentRecord[], note = BRIEF) =>
    render(<WorkspaceCommentsColumn {...props({ comments, suggestedProperties: suggestedProperties(note, comments) })} />);
  const diffOf = (host: HTMLElement) => host.querySelector("[data-testid=comment-diff]")!;
  const labelOf = (host: HTMLElement) => host.querySelector("[data-testid=comment-property-label]")?.textContent ?? null;
  const states = (host: HTMLElement) => [...host.querySelectorAll(".pv-comment-card__state")].map((node) => node.textContent);

  it("says that it is a property and shows it by its name, what it says struck and what it would say — not a line of YAML", () => {
    const { host, unmount } = column([proposal("p1", 4, 15, "stage: sent", "stage", { body: "Sent on Monday" })]);
    expect(labelOf(host)).toBe(tr("comments.suggestionProperty"));
    const diff = diffOf(host);
    expect(diff.getAttribute("data-property")).toBe("stage");
    expect(diff.querySelector(".pv-comment-card__prop")!.textContent).toBe("stage");
    expect(diff.querySelector("del")!.textContent).toBe("open");
    expect(diff.querySelector("ins")!.textContent).toBe("sent");
    expect(diff.textContent).not.toContain(":");
    // While it fits there is nothing more to say, and it is decided like every suggestion.
    expect(states(host)).toEqual([]);
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent?.trim());
    expect(labels).toContain(tr("comments.suggestionApply"));
    expect(labels).toContain(tr("comments.suggestionDecline"));
    unmount();
  });

  it("counts a round of one as one change — every value an assistant proposes is such a round", () => {
    const { host, unmount } = column([proposal("p1", 4, 15, "stage: sent", "stage", { suggestionBatchId: "cd".repeat(16), batchIndex: 0, batchNote: "Sent today" })]);
    act(() => { (host.querySelector("[data-testid=comment-kind-suggestions]") as HTMLElement).click(); });
    const meta = host.querySelector(".pv-comment-round__meta")!;
    expect(meta.textContent).toBe(`„Sent today“ · ${tr("comments.suggestRoundCount_one").replace("{{count}}", "1")}`);
    expect(meta.textContent!.endsWith("1 change")).toBe(true);
    expect(diffOf(host).getAttribute("data-property")).toBe("stage");
    unmount();
  });

  it("names a removal, and a property the note does not have yet", () => {
    const removal = column([proposal("p1", 15, 27, "", "owner")]);
    expect(diffOf(removal.host).querySelector(".pv-comment-card__prop")!.textContent).toBe("owner");
    expect(diffOf(removal.host).querySelector("del")!.textContent).toBe("Anna");
    expect(diffOf(removal.host).querySelector("ins")).toBeNull();
    expect(diffOf(removal.host).textContent).toContain(tr("comments.suggestionPropertyRemoves"));
    removal.unmount();

    // A new property is an entry in front of the line that closes the properties; a list reads as its items.
    const added = column([proposal("p2", 28, 28, "tags:\n  - roof\n  - house\n")]);
    expect(diffOf(added.host).getAttribute("data-property")).toBe("tags");
    expect(diffOf(added.host).querySelector("del")).toBeNull();
    expect(diffOf(added.host).querySelector("ins")!.textContent).toBe("roof, house");
    // The label says that the note has no such property yet; no further line is needed for that.
    expect(labelOf(added.host)).toBe(tr("comments.suggestionPropertyNew"));
    expect(states(added.host)).toEqual([]);
    added.unmount();
  });

  it("says when the property says something else by now, instead of offering it as if nothing had happened", () => {
    const waiting = proposal("p1", 4, 15, "stage: sent", "stage");
    const { host, unmount } = column([waiting], BRIEF.replace("stage: open", "stage: closed"));
    // What it was proposed against stays on the card; the sentence says that it no longer fits.
    expect(diffOf(host).querySelector("del")!.textContent).toBe("open");
    expect(states(host)).toEqual([tr("comments.suggestionPropertyChanged").replace("{{key}}", "stage")]);
    unmount();

    // The note has the property by now: the new one no longer fits either.
    const added = column([proposal("p2", 28, 28, "effort: 3\n")], BRIEF.replace("owner: Anna\n", "owner: Anna\neffort: 5\n"));
    expect(states(added.host)).toEqual([tr("comments.suggestionPropertyChanged").replace("{{key}}", "effort")]);
    added.unmount();
  });

  it("says what became of a decided one, and nothing about fitting", () => {
    const applied = proposal("p1", 4, 15, "stage: sent", "stage", { resolvedAt: NOW, suggestion: { replacement: "stage: sent", appliedAt: NOW, appliedBy: "aabbccdd11223344", declinedAt: null } });
    // The note after accepting: the entry it was made against is gone, as it should be.
    const { host, unmount } = column([applied], BRIEF.replace("stage: open", "stage: sent"));
    showAll(host);
    expect(labelOf(host)).toBe(tr("comments.suggestionProperty"));
    expect(diffOf(host).getAttribute("data-property")).toBe("stage");
    expect(states(host).map((text) => text?.trim())).toEqual([tr("comments.suggestionApplied")]);
    unmount();
  });

  it("stays a passage where nobody read it against a note, and a line in the text stays text", () => {
    // Without the editor's reading the card shows the entry as the passage it is: nothing is lost, only less is said.
    const bare = render(<WorkspaceCommentsColumn {...props({ comments: [proposal("p1", 4, 15, "stage: sent", "stage")] })} />);
    expect(diffOf(bare.host).hasAttribute("data-property")).toBe(false);
    expect(diffOf(bare.host).textContent).toContain("stage:");
    expect(labelOf(bare.host)).toBeNull();
    bare.unmount();

    // Three dashes also draw a rule in a note's text: a line inserted in front of one is text, whatever it looks like.
    const ruled = "---\nstage: open\n---\n# Brief\n\nAbove.\n\n---\n\nBelow.\n";
    const at = ruled.indexOf("---\n\nBelow.");
    const line = comment({ commentId: "p2", anchor: buildCommentAnchor(ruled, at, at, "7f3a"), suggestion: { replacement: "effort: 3\n", appliedAt: null, appliedBy: null, declinedAt: null } });
    const text = column([line], ruled);
    expect(diffOf(text.host).hasAttribute("data-property")).toBe(false);
    expect(states(text.host)).toEqual([]);
    text.unmount();
  });
});
