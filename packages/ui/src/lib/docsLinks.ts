import i18n from "../i18n";
import { matchAppLanguage } from "../services/languages";

/**
 * Deep links into the user guide on plainva.com.
 *
 * The handbook ships in all ten app languages under `docs/user/<code>/`, and
 * since the website publishes every one of them the link follows the app
 * language (with the registry's en fallback for anything unknown).
 *
 * These used to point at the Markdown source on GitHub. That was the honest
 * choice while the site served two languages — a raw file in your own language
 * beats a rendered page in someone else's. The site has all ten now, so the
 * link goes where the reader can actually read it: rendered, with the sidebar
 * and the rest of the handbook one click away.
 *
 * Callers still name the handbook FILE (`userGuideUrl("OKF.md")`) because that
 * is what exists in the repo and what a developer greps for; the mapping to the
 * web slug lives here and mirrors `scripts/sync-docs.mjs` in the website repo.
 * If those two ever disagree the link 404s — hence the test.
 */
const DOCS_BASE = "https://plainva.com";

export const GDRIVE_BYO_GUIDE = "Google_Drive_BYO_Guide.md";
export const ONEDRIVE_DROPBOX_BYO_GUIDE = "OneDrive_and_Dropbox_BYO_Guide.md";

/** Handbook file name → website slug. `README.md` is the section index. */
export function docsSlug(page: string): string {
  const base = page.replace(/\.md$/i, "");
  return base === "README" ? "" : base.toLowerCase().replace(/_/g, "-");
}

export function userGuideUrl(page: string): string {
  const lang = matchAppLanguage(i18n.language);
  const prefix = lang === "en" ? "" : `/${lang}`;
  const slug = docsSlug(page);
  return `${DOCS_BASE}${prefix}/docs${slug ? `/${slug}` : ""}`;
}
