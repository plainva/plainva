import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AtSign, Bell, BellOff, Check, CornerDownRight, ListChecks, MessageSquare, Replace, Send, Share2, Trash2, X } from "lucide-react";
import type { PublicationComment, WorkspaceCommentAnchorResolution, WorkspaceCommentRecord, WorkspacePropertyAnchorResolution } from "@plainva/core";
import type { CommentThread } from "@plainva/ui";
import { anchorDisplayLabel, Button, buildCommentThreads, CommentBody as SharedCommentBody, CommentCardHead, groupSuggestionRounds, ICON, IconButton, isCommentThreadOpen, MentionTextArea, Segmented, SuggestionDiff, TextArea, toAnchorDisplayHint, toast } from "@plainva/ui";

/** A top-level comment with the replies hanging off it, in posting order. */

/**
 * A remark that came back from someone this note was published to (D7), plus
 * the name of the publication it arrived through.
 */
export type PublicationCommentEntry = PublicationComment & { publicationName: string };

export interface WorkspaceCommentsColumnProps {
  comments: readonly WorkspaceCommentRecord[];
  /** memberId -> display name from the workspace policy. */
  memberNames: ReadonlyMap<string, string>;
  /**
   * Who this device is - the member id in a workspace, the device id in a plain
   * vault. Null while that is still being read, and then nothing counts as
   * addressed: claiming every mention is yours would be worse than claiming none.
   */
  selfMemberId: string | null;
  /** commentId -> where its anchor currently lands; absent means note-wide. */
  resolutions: ReadonlyMap<string, WorkspaceCommentAnchorResolution>;
  /**
   * commentId -> which frontmatter key a property comment (Stufe E, E2) points
   * at today. Deliberately a SECOND map: a property anchor has no range, and its
   * verdicts ("renamed", "orphan") mean something different from a text
   * anchor's - folding both into one map would force every reader to guess
   * which vocabulary a status belongs to.
   */
  propertyResolutions?: ReadonlyMap<string, WorkspacePropertyAnchorResolution>;
  canComment: boolean;
  /**
   * Whether this member may write the note - which is what accepting a
   * suggestion does. A commenter without write access can propose and decline,
   * but the swap itself is a write and stays out of reach.
   */
  canWrite: boolean;
  /** The card whose range is emphasised in the text, or null. */
  activeCommentId: string | null;
  /** What a new comment would attach to, or null for the note as a whole. */
  selectionQuote: string | null;
  onSelect(commentId: string | null): void;
  /**
   * Posts a comment; `parentCommentId` null starts a new thread. A non-null
   * `suggestion` proposes a replacement for the current selection - it changes
   * nothing in the note, it only describes what could stand there instead.
   */
  onSubmit(body: string, parentCommentId: string | null, suggestion: { replacement: string } | null): Promise<void>;
  onResolve(commentId: string): void;
  /** A queued remark that failed to publish: try again now (K6). */
  onRetryPending?(outboxId: string): void;
  /** The head's close button (K3) - the toolbar button reopens the column. */
  onClose?(): void;
  /** A `[[wiki link]]` in a remark - the reply "task created" carries one (K4). */
  onOpenNote?(target: string): void;
  onOpenUrl?(url: string): void;
  /** Deletes a remark (K7). Offered to its author, and to a moderator on everything. */
  onDelete?(comment: WorkspaceCommentRecord): void;
  /** True for a member who governs the workspace: may delete anybody's remark. */
  canModerate?: boolean;
  /** Whether open suggestions are drawn in the text (K5); the head carries the switch. */
  inlineSuggestions?: boolean;
  onToggleInlineSuggestions?(): void;
  /** A whole proposal round at once (V3): accept every open block in one write, or decline them all. */
  onApplyRound?(batchId: string): void;
  onDeclineRound?(batchId: string): void;
  /** ...or let it go. Only the person who wrote it decides that. */
  onDiscardPending?(outboxId: string): void;
  /** Writes the proposed text into the note and closes the thread. */
  onApplySuggestion(comment: WorkspaceCommentRecord): void;
  /** Closes the thread without touching the note. */
  onDeclineSuggestion(comment: WorkspaceCommentRecord): void;
  /**
   * Turns the thread into a task in the default task database (D11).
   *
   * Gated on `canComment` rather than on write access: what it does HERE is
   * post the reply that links to the task - the task note itself lands in a
   * different note entirely, in the database's own folder.
   */
  onPromoteToTask(comment: WorkspaceCommentRecord): void;
  /**
   * What the recipients of this note's publications wrote back.
   *
   * Its own list rather than mixed into `comments`, because these differ in
   * three ways at once that a reader has to be able to see: they come from
   * outside this vault, their names come from the publication's policy and not
   * this one's, and nothing here can be replied to, resolved or applied from
   * this side - answering means writing into the publication, which is a
   * different act than writing in the note.
   */
  publicationComments?: readonly PublicationCommentEntry[];
  /**
   * Whether this note is silenced, and how to change that (Stufe F, §3 rule 4).
   *
   * It sits in the column rather than in a settings page because silence is a
   * state of THIS note, and the moment somebody wants it is the moment they are
   * looking at the remarks. Absent when the shell does not offer notifications
   * at all, in which case the row does not appear.
   */
  muted?: boolean;
  onToggleMute?(): void;
}

/**
 * The comment column beside the note.
 *
 * It replaces a collapsed list that showed the first eight characters of a
 * member id, carried no threads, and printed the literal English word
 * "Resolved" in every language. A name here is a CLAIM the workspace policy
 * carries, not a verified identity - the technical id stays reachable on the
 * card so nobody has to take the name on faith. A revoked member keeps the name
 * on old comments; anything else would falsify the record.
 */
export function WorkspaceCommentsColumn({
  comments, memberNames, selfMemberId, resolutions, propertyResolutions, canComment, canWrite, activeCommentId, selectionQuote,
  onSelect, onSubmit, onResolve, onApplySuggestion, onDeclineSuggestion, onPromoteToTask, onRetryPending, onDiscardPending, onClose, onOpenNote, onOpenUrl, onDelete, canModerate, inlineSuggestions, onToggleInlineSuggestions, onApplyRound, onDeclineRound,
  publicationComments = [], muted, onToggleMute,
}: WorkspaceCommentsColumnProps) {
  const { t, i18n } = useTranslation();
  /** "Open" hides what is settled; "all" brings resolved threads back (K3). */
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [draft, setDraft] = useState("");
  // The replacement starts as the selected text: a suggestion is almost always
  // an edit of the passage, not a blank page.
  const [replacement, setReplacement] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  /** The remark whose deletion is being confirmed, in its own card (K7). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const mayDelete = (record: WorkspaceCommentRecord) => !!onDelete && !record.pending && (record.authorMemberId === selfMemberId || canModerate === true);
  const deleteControl = (record: WorkspaceCommentRecord) => mayDelete(record) ? (
    <IconButton
      size="sm"
      label={t("workspaceSecurity.commentDelete")}
      onClick={(event) => { event.stopPropagation(); setConfirmDelete(confirmDelete === record.commentId ? null : record.commentId); }}
      data-testid={`comment-delete-${record.commentId}`}
    >
      <Trash2 size={ICON.meta} />
    </IconButton>
  ) : null;
  const confirmBox = (record: WorkspaceCommentRecord, replyCount: number) => confirmDelete === record.commentId ? (
    <div className="pv-comment-card__confirm" role="alertdialog" onClick={(event) => event.stopPropagation()}>
      <span>{replyCount > 0 ? t("workspaceSecurity.commentDeleteConfirmThread") : t("workspaceSecurity.commentDeleteConfirm")}</span>
      <div className="pv-comment-card__actions">
        <Button variant="danger" size="sm" onClick={() => { setConfirmDelete(null); onDelete?.(record); }} data-testid="comment-delete-confirm">
          {t("workspaceSecurity.commentDelete")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
      </div>
    </div>
  ) : null;
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const threads = useMemo(
    () => buildCommentThreads(comments, selfMemberId, memberNames),
    [comments, memberNames, selfMemberId],
  );
  const openCount = useMemo(() => threads.filter((thread) => isCommentThreadOpen(thread.root)).length, [threads]);
  const shownThreads = useMemo(
    () => (filter === "open" ? threads.filter((thread) => isCommentThreadOpen(thread.root) || thread.root.pending) : threads),
    [threads, filter],
  );
  // Rounds (V3) are grouped out of the shown threads: what a "send" produced
  // stays together, with its sentence and one decision for all of it.
  const grouped = useMemo(() => groupSuggestionRounds(shownThreads), [shownThreads]);

  const authorOf = (comment: WorkspaceCommentRecord): string =>
    memberNames.get(comment.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor");

  /**
   * The returns, grouped by the publication they arrived through.
   *
   * Grouped rather than merged, because a comment id is only unique INSIDE its
   * publication - threading across two of them could staple a reply from one
   * recipient under a root from another. The names come from the records
   * themselves: core resolved them against the publication's own policy, and
   * this vault's member list does not contain these people at all.
   */
  const publicationGroups = useMemo(() => {
    const groups = new Map<string, { name: string; names: Map<string, string>; entries: PublicationCommentEntry[] }>();
    for (const entry of publicationComments) {
      let group = groups.get(entry.publicationId);
      if (!group) {
        group = { name: entry.publicationName, names: new Map(), entries: [] };
        groups.set(entry.publicationId, group);
      }
      // No name in the publication's policy either: the id stays on the card,
      // so an unnamed recipient is still attributable.
      if (entry.authorDisplayName) group.names.set(entry.comment.authorMemberId, entry.authorDisplayName);
      group.entries.push(entry);
    }
    return [...groups.values()].map((group) => ({
      name: group.name,
      names: group.names,
      // No self here on purpose: the publisher is a different member inside the
      // publication than in this vault, so a mention check against this vault's
      // id would answer a question nobody asked.
      threads: buildCommentThreads(group.entries.map((entry) => entry.comment), null, group.names),
      byId: new Map(group.entries.map((entry) => [entry.comment.commentId, entry])),
    }));
  }, [publicationComments]);

  const post = async (body: string, parent: string | null, suggestion: { replacement: string } | null = null) => {
    setBusy(true);
    try {
      await onSubmit(body, parent, suggestion);
      if (parent === null) { setDraft(""); setReplacement(null); }
      else { setReplyDraft(""); setReplyTo(null); }
    } catch (error) {
      // A refused post used to be an unhandled rejection: the draft stayed and
      // nothing said why (finding 2026-09-03, K6). The draft still stays - it
      // is the person's text - but the reason is now on screen.
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** The sending / not-sent line of a queued remark (K6); null once it has landed. */
  const pendingState = (record: WorkspaceCommentRecord, own: boolean) => {
    if (!record.pending) return null;
    if (record.pending.lastError === null) {
      return <span className="pv-comment-card__state" data-state="sending"><Send size={ICON.meta} /> {t("workspaceSecurity.commentSending")}</span>;
    }
    return (
      <>
        <span className="pv-comment-card__state" data-state="error"><AlertCircle size={ICON.meta} /> {t("workspaceSecurity.commentSendFailed", { reason: record.pending.lastError })}</span>
        {own && onRetryPending && (
          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onRetryPending(record.pending!.outboxId); }}>
            {t("workspaceSecurity.commentSendRetry")}
          </Button>
        )}
        {own && onDiscardPending && (
          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onDiscardPending(record.pending!.outboxId); }}>
            {t("workspaceSecurity.commentSendDiscard")}
          </Button>
        )}
      </>
    );
  };

  const anchorNote = (comment: WorkspaceCommentRecord) => {
    if (!comment.anchor) return null;
    // A property comment first: it never reaches `resolutions`, and its own
    // verdict decides whether the card names the original key, the key it was
    // renamed to, or admits the property is gone.
    const property = propertyResolutions?.get(comment.commentId);
    if (property) {
      if (property.status === "orphan") {
        // The property is gone, so the card carries the whole record: the key
        // it was written against, and the value it held at the time. Without
        // the value an orphan is a name with nothing behind it.
        return (
          <span className="pv-comment-card__state">
            {t("workspaceSecurity.commentPropertyOrphan", {
              key: comment.anchor.display?.kind === "property" ? comment.anchor.display.key : "",
            })}
            {comment.anchor.quote
              ? ` ${t("workspaceSecurity.commentPropertyOrphanValue", { value: comment.anchor.quote })}`
              : ""}
          </span>
        );
      }
      // The record itself is sealed, so the renamed key is composed here for
      // display only - nothing writes it back into the anchor.
      const hint = toAnchorDisplayHint(
        comment.anchor.display,
        property.status === "renamed" ? property.key : undefined,
      ) ?? { kind: "property" as const, key: property.key };
      const label = anchorDisplayLabel(hint);
      return (
        <span className="pv-comment-card__state">
          {t(label.key, label.params)}
          {label.caveat && ` · ${t(label.caveat)}`}
        </span>
      );
    }
    const status = resolutions.get(comment.commentId)?.status;
    if (status === "orphan") return <span className="pv-comment-card__state">{t("workspaceSecurity.commentAnchorOrphan")}</span>;
    if (status === "moved") return <span className="pv-comment-card__state">{t("workspaceSecurity.commentAnchorMoved")}</span>;
    // Stufe E (E1): a widget covers the range, so there is no quote to show.
    // The card names the thing instead - "on the image" beats an empty card.
    const displayHint = toAnchorDisplayHint(comment.anchor.display);
    if (displayHint) {
      const label = anchorDisplayLabel(displayHint);
      return (
        <span className="pv-comment-card__state">
          {t(label.key, label.params)}
          {label.caveat && ` · ${t(label.caveat)}`}
        </span>
      );
    }
    return null;
  };

  /**
   * What became of a suggestion. Accepting and declining both resolve the
   * thread, so the plain "resolved" word would say the same in both cases -
   * and hide the one thing a reader wants to know.
   */
  const suggestionState = (comment: WorkspaceCommentRecord) => {
    if (!comment.suggestion) return null;
    if (comment.suggestion.appliedAt) return <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.suggestionApplied")}</span>;
    if (comment.suggestion.declinedAt) return <span className="pv-comment-card__state"><X size={ICON.meta} /> {t("workspaceSecurity.suggestionDeclined")}</span>;
    // Resolved without an outcome: a device that predates suggestions closed
    // the thread. Saying "resolved" is the honest answer, not a guess.
    if (comment.resolvedAt) return <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.resolved")}</span>;
    return null;
  };

  /** One thread as a card - the same card inside a round and on its own. */
  const renderThread = ({ root, replies, addressed }: CommentThread) => (
        <div
          key={root.commentId}
          className={`pv-comment-card${root.resolvedAt ? " is-resolved" : ""}${activeCommentId === root.commentId ? " is-active" : ""}${root.pending ? " is-pending" : ""}`}
          onClick={() => onSelect(activeCommentId === root.commentId ? null : root.commentId)}
        >
          {root.suggestion
            ? <SuggestionDiff quote={root.anchor?.quote ?? ""} replacement={root.suggestion.replacement} deletesLabel={t("workspaceSecurity.suggestionDeletes")} />
            : root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
          {addressed && (
            <span className="pv-comment-card__state">
              <AtSign size={ICON.meta} /> {t("workspaceSecurity.commentMentionsYou")}
            </span>
          )}
          {anchorNote(root)}
          <CommentBody comment={root} author={authorOf(root)} names={memberNames} locale={i18n.language} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
          {replies.map((reply) => (
            <div key={reply.commentId} className="pv-comment-card__reply">
              <CommentBody comment={reply} author={authorOf(reply)} names={memberNames} locale={i18n.language} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
              {reply.pending && <div className="pv-comment-card__actions">{pendingState(reply, reply.authorMemberId === selfMemberId)}</div>}
              {mayDelete(reply) && <div className="pv-comment-card__actions pv-comment-card__actions--quiet">{deleteControl(reply)}</div>}
              {confirmBox(reply, 0)}
            </div>
          ))}
          {root.pending ? (
            // Still on its way (or stuck): no reply, resolve or task yet - each
            // of those would queue behind a remark that may never land.
            <div className="pv-comment-card__actions">{pendingState(root, root.authorMemberId === selfMemberId)}</div>
          ) : (
          <div className="pv-comment-card__actions pv-comment-card__actions--quiet">
            {canComment && !root.resolvedAt && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => { event.stopPropagation(); setReplyTo(replyTo === root.commentId ? null : root.commentId); setReplyDraft(""); }}
              >
                <CornerDownRight size={ICON.meta} /> {t("workspaceSecurity.commentReply")}
              </Button>
            )}
            {suggestionState(root)}
            {/* Available on a plain remark and on a proposal alike: both can
                turn out to be work, and which one it was does not change that. */}
            {canComment && !root.resolvedAt && (
              <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onPromoteToTask(root); }}>
                <ListChecks size={ICON.meta} /> {t("workspaceSecurity.commentToTask")}
              </Button>
            )}
            {root.resolvedAt
              ? !root.suggestion && <span className="pv-comment-card__state"><Check size={ICON.meta} /> {t("workspaceSecurity.resolved")}</span>
              : root.suggestion
                ? (
                  <>
                    {/* Accepting is an ordinary write, so it needs write access;
                        declining only closes the thread. */}
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onApplySuggestion(root); }}>
                        <Check size={ICON.meta} /> {t("workspaceSecurity.suggestionApply")}
                      </Button>
                    )}
                    {canComment && (
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onDeclineSuggestion(root); }}>
                        <X size={ICON.meta} /> {t("workspaceSecurity.suggestionDecline")}
                      </Button>
                    )}
                  </>
                )
                : canComment && (
                  <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onResolve(root.commentId); }}>
                    {t("workspaceSecurity.resolve")}
                  </Button>
                )}
            {deleteControl(root)}
          </div>
          )}
          {confirmBox(root, replies.length)}
          {replyTo === root.commentId && (
            <div className="pv-comment-compose" onClick={(event) => event.stopPropagation()}>
              <MentionTextArea
                value={replyDraft}
                rows={2}
                names={memberNames}
                pickerLabel={t("workspaceSecurity.commentMentionPicker")}
                placeholder={t("workspaceSecurity.commentReplyPlaceholder")}
                onChange={setReplyDraft}
              />
              <Button size="sm" disabled={busy || !replyDraft.trim()} onClick={() => void post(replyDraft.trim(), root.commentId)}>
                {t("workspaceSecurity.send")}
              </Button>
            </div>
          )}
        </div>
  );

  return (
    <aside className="pv-comment-column" aria-label={t("workspaceSecurity.comments")}>
      <div className="pv-comment-column__head">
        <h3 className="pv-comment-column__title">
          {t("workspaceSecurity.comments")}
          <span className="pv-comment-column__count" data-testid="comment-open-count">{t("workspaceSecurity.commentOpenCount", { n: openCount })}</span>
        </h3>
        <span className="pv-comment-column__spacer" />
        {threads.length > 0 && (
          <Segmented
            size="sm"
            ariaLabel={t("workspaceSecurity.comments")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: t("workspaceSecurity.commentFilterOpen"), testId: "comment-filter-open" },
              { value: "all", label: t("workspaceSecurity.commentOverviewAll"), testId: "comment-filter-all" },
            ]}
          />
        )}
        {onToggleInlineSuggestions && (
          <IconButton
            label={t("workspaceSecurity.suggestionInline")}
            active={inlineSuggestions === true}
            onClick={onToggleInlineSuggestions}
            data-testid="comment-inline-toggle"
          >
            <Replace size={ICON.ui} />
          </IconButton>
        )}
        {muted && <span className="pv-comment-column__muted">{t("commentNotify.muted")}</span>}
        {onToggleMute && (
          <IconButton
            label={muted ? t("commentNotify.unmute") : t("commentNotify.mute")}
            active={muted}
            onClick={onToggleMute}
            data-testid="comment-mute"
          >
            {muted ? <BellOff size={ICON.ui} /> : <Bell size={ICON.ui} />}
          </IconButton>
        )}
        {onClose && (
          <IconButton label={t("workspaceSecurity.commentColumnHide")} onClick={onClose} data-testid="comment-column-close">
            <X size={ICON.ui} />
          </IconButton>
        )}
      </div>
      <div className="pv-comment-column__body">
      {threads.length === 0 && publicationComments.length === 0 && <p className="pv-comment-column__empty">{t("workspaceSecurity.commentsNone")}</p>}
      {grouped.rounds.map((round) => {
        const open = round.blocks.filter((block) => isCommentThreadOpen(block.root));
        return (
          <section key={round.batchId} className="pv-comment-round" aria-label={t("workspaceSecurity.suggestRound", { name: memberNames.get(round.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor") })}>
            <div className="pv-comment-round__head">
              <CommentCardHead name={memberNames.get(round.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor")} memberId={round.authorMemberId} createdAt={round.createdAt} locale={i18n.language} />
              <p className="pv-comment-round__meta">
                {round.note ? <em>„{round.note}“ · </em> : null}
                {t("workspaceSecurity.suggestRoundCount", { n: round.blocks.length })}
              </p>
              {open.length > 1 && (
                <div className="pv-comment-card__actions">
                  {canWrite && onApplyRound && (
                    <Button variant="ghost" size="sm" onClick={() => onApplyRound(round.batchId)} data-testid={`round-apply-${round.batchId}`}>
                      <Check size={ICON.meta} /> {t("workspaceSecurity.suggestApplyAll")}
                    </Button>
                  )}
                  {canComment && onDeclineRound && (
                    <Button variant="ghost" size="sm" onClick={() => onDeclineRound(round.batchId)}>
                      <X size={ICON.meta} /> {t("workspaceSecurity.suggestDeclineAll")}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="pv-comment-round__blocks">{round.blocks.map(renderThread)}</div>
          </section>
        );
      })}
      {grouped.threads.map(renderThread)}
      </div>
      {canComment && (
        <div className="pv-comment-column__foot">
        <div className="pv-comment-compose pv-comment-compose--new">
          <p className="pv-comment-compose__target">
            {selectionQuote
              ? t("workspaceSecurity.commentOnSelection", { quote: selectionQuote })
              : t("workspaceSecurity.commentOnNote")}
          </p>
          {/* Deliberately a plain field: this text becomes the NOTE. An `@Name`
              picked in here would be written into the document, where it means
              nothing and nobody would ever be notified. */}
          {replacement !== null && (
            <TextArea
              value={replacement}
              rows={2}
              className="pv-comment-compose__replacement"
              placeholder={t("workspaceSecurity.suggestionPlaceholder")}
              onChange={(event) => setReplacement(event.target.value)}
            />
          )}
          <MentionTextArea
            value={draft}
            rows={3}
            names={memberNames}
            pickerLabel={t("workspaceSecurity.commentMentionPicker")}
            placeholder={replacement !== null ? t("workspaceSecurity.suggestionWhyPlaceholder") : t("workspaceSecurity.addComment")}
            onChange={setDraft}
          />
          <div className="pv-comment-compose__actions">
            {/* A proposal has to name the passage it replaces - without a
                selection there is nothing to propose against, so the switch
                only appears once something is selected. */}
            {selectionQuote !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplacement(replacement === null ? selectionQuote : null)}
              >
                <Replace size={ICON.meta} /> {replacement === null ? t("workspaceSecurity.suggestionStart") : t("workspaceSecurity.suggestionCancel")}
              </Button>
            )}
            {/* A suggestion may carry no sentence at all: the replacement text
                IS the content. A plain remark still needs words. */}
            <Button size="sm" disabled={busy || (replacement === null && !draft.trim())} onClick={() => void post(draft.trim(), null, replacement === null ? null : { replacement })}>
              <MessageSquare size={ICON.meta} /> {replacement === null ? t("workspaceSecurity.send") : t("workspaceSecurity.suggestionSend")}
            </Button>
          </div>
        </div>
        </div>
      )}
      {/* What came back from the people this note was published to (D7).
          Read-only by construction: answering means writing into the
          publication, which is a different act than writing in this note - and
          a button that looked like the ones above would promise otherwise. */}
      {publicationGroups.map((group) => (
        <section key={group.name} className="pv-comment-returns" aria-label={t("workspaceSecurity.publicationCommentsFrom", { name: group.name })}>
          <h4 className="pv-comment-returns__heading">
            <Share2 size={ICON.meta} /> {t("workspaceSecurity.publicationCommentsFrom", { name: group.name })}
          </h4>
          {group.threads.map(({ root, replies }) => {
            const entry = group.byId.get(root.commentId);
            return (
              <div key={root.commentId} className="pv-comment-card pv-comment-card--incoming">
                {root.suggestion
                  ? <SuggestionDiff quote={root.anchor?.quote ?? ""} replacement={root.suggestion.replacement} deletesLabel={t("workspaceSecurity.suggestionDeletes")} />
                  : root.anchor && <blockquote className="pv-comment-card__quote">{root.anchor.quote}</blockquote>}
                <CommentBody comment={root} author={group.names.get(root.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor")} names={group.names} locale={i18n.language} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
                {replies.map((reply) => (
                  <div key={reply.commentId} className="pv-comment-card__reply">
                    <CommentBody comment={reply} author={group.names.get(reply.authorMemberId) ?? t("workspaceSecurity.commentUnknownAuthor")} names={group.names} locale={i18n.language} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
                  </div>
                ))}
                {/* Both lines state a fact about the record, not a failure: the
                    remark stands either way, and hiding it would rewrite what
                    was actually said. */}
                {entry?.authorActive === false && (
                  <span className="pv-comment-card__state">{t("workspaceSecurity.publicationCommentAuthorGone")}</span>
                )}
                {root.suggestion && entry?.suggestionApplicable === false && (
                  <span className="pv-comment-card__state">{t("workspaceSecurity.publicationSuggestionStale")}</span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}

/**
 * One comment, with `@Name` lifted out of the text.
 *
 * The mentions are DERIVED here, never stored: the body is the single truth, so
 * a renamed member changes what this shows and nothing has to be migrated.
 */
function CommentBody({
  comment,
  author,
  names,
  locale,
  onOpenNote,
  onOpenUrl,
}: {
  comment: WorkspaceCommentRecord;
  author: string;
  names: ReadonlyMap<string, string>;
  locale: string;
  onOpenNote?: (target: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  return (
    <>
      <CommentCardHead name={author} memberId={comment.authorMemberId} createdAt={comment.createdAt} locale={locale} />
      <SharedCommentBody body={comment.body} names={names} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
    </>
  );
}
