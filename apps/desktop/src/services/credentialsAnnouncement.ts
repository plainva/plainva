/**
 * Tells the open vault that sync credentials changed - it reloads to pick them up.
 *
 * A reload replaces the window with the loading screen, and the settings come
 * back on the account list: the wizard that had just connected lost its result
 * rows, so a calendar left unticked at the consent never said so (finding
 * 2026-10-23, found by the end-to-end test against the stand-in provider).
 * While a surface shows such a result it holds the announcement; the vault
 * reloads once, when the surface is left.
 */
export function announceCredentials(isNewConnection: boolean): void {
  if (announcementHolds > 0) {
    heldAnnouncement = (heldAnnouncement ?? false) || isNewConnection;
    return;
  }
  window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection } }));
}

let announcementHolds = 0;
let heldAnnouncement: boolean | null = null;

/** Holds `announceCredentials` until the returned release; the last release sends what was held, once. */
export function holdCredentialsAnnouncements(): () => void {
  announcementHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    announcementHolds -= 1;
    if (announcementHolds > 0 || heldAnnouncement === null) return;
    const isNewConnection = heldAnnouncement;
    heldAnnouncement = null;
    announceCredentials(isNewConnection);
  };
}
