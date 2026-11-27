/**
 * The uid for ONE create of the person (`PimEventDraft.createAs`): made once
 * when the form is saved, sent with every try of it, so "Try again" after an
 * answer that never came or a read-back that failed cannot leave the event on
 * the server twice (issue 119). A module of its own: the shells and the start
 * reach it without the CalDAV adapter and its calendar parser.
 */
export function newPimCreateUid(): string {
  return `plainva-${globalThis.crypto.randomUUID()}`;
}

/**
 * How long an address this app created and the provider does not show yet is
 * taken for "not shown yet" rather than "gone" (issue 119) - by the CalDAV
 * target for every operation on it, and by the watch of created events, whose
 * first "not there" counts only after this. One clock for both: a provider
 * that shows late is never told apart by two different patiences.
 *
 * 15 minutes: the delays reported for iCloud (issue 119) were "over a
 * minute"; a quarter of an hour covers them many times over, and is short
 * enough that an event created here and deleted on another device the same
 * morning is not taken for one that is still on its way.
 */
export const NOT_SHOWN_YET_MS = 15 * 60_000;
