/**
 * The release notes of a catalog entry: the GitHub release of its version
 * (finding X10, review 2026-11-10). "What's new" sends people to "the release
 * notes" for the details and used to link only the blog post.
 */
export function getWhatsNewReleaseNotesUrl(release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version ?? "")) return undefined;
  return `https://github.com/plainva/plainva/releases/tag/v${release.version}`;
}

/** The same blog destination for both app shells and the store-note generator. */
export function getWhatsNewBlogUrl(release, language = "en") {
  if (!release.blogUrl) return undefined;
  const url = new globalThis.URL(release.blogUrl);
  // Historical releases have English and German posts. Each new catalog entry
  // can name its actual translations; absent languages fall back to English.
  const available = release.blogLanguages ?? ["en", "de"];
  const requested = language.toLowerCase().replace(/_/g, "-");
  const base = requested.split("-")[0];
  const locale = available.find(lang => lang.toLowerCase() === requested)
    ?? available.find(lang => lang.toLowerCase().split("-")[0] === base)
    ?? "en";
  if (url.hostname === "plainva.com" && url.pathname.startsWith("/blog/")) {
    url.pathname = `${locale === "en" ? "" : `/${locale}`}${url.pathname}`;
  }
  return url.toString();
}
