export function getWhatsNewReleaseNotesUrl(release: { version?: string }): string | undefined;

export function getWhatsNewBlogUrl(
  release: { blogUrl?: string; blogLanguages?: readonly string[] },
  language?: string,
): string | undefined;
