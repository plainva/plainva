/**
 * Deep links into the user guide — the implementation moved to `@plainva/ui`
 * so the phone can use the same links (P4.1). This re-export keeps the desktop
 * import path, and with it the diff of that move at zero.
 */
export { userGuideUrl, GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE } from "@plainva/ui";
