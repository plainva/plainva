/**
 * Which sign-in failures a screen has already put into words.
 *
 * A refused account sign-in is announced at its card (a banner on the account
 * page). The OAuth redirect handler that ran it also reports every failure as
 * a toast - so one refusal used to be said twice, in two wordings (found by
 * the end-to-end test of account sign-in plan E6). A failure marked here is
 * left to the card.
 */
const announced = new WeakSet<object>();

export function markSignInAnnounced<T>(error: T): T {
  if (error && typeof error === "object") announced.add(error);
  return error;
}

export function wasSignInAnnounced(error: unknown): boolean {
  return !!error && typeof error === "object" && announced.has(error);
}
