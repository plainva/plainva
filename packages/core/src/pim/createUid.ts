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
