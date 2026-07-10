import i18n from "@plainva/ui/i18n";
import { matchAppLanguage } from "@plainva/ui";

/**
 * Deep links into the user guide on GitHub (P3.12): the handbook ships in all
 * ten app languages under docs/user/<code>/, so the link follows the app
 * language (with the registry's en fallback for anything unknown).
 */
const DOCS_BASE = "https://github.com/plainva/plainva/blob/main/docs/user";

export const GDRIVE_BYO_GUIDE = "Google_Drive_BYO_Guide.md";
export const ONEDRIVE_DROPBOX_BYO_GUIDE = "OneDrive_and_Dropbox_BYO_Guide.md";

export function userGuideUrl(page: string): string {
  return `${DOCS_BASE}/${matchAppLanguage(i18n.language)}/${page}`;
}
