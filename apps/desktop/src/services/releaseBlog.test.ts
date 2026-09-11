import { describe, expect, it } from "vitest";
import { getWhatsNewBlogUrl, getLatestWhatsNew } from "@plainva/ui";

describe("release blog destinations", () => {
  it("uses each translation declared by the current release", () => {
    const release = getLatestWhatsNew();
    for (const language of release.blogLanguages ?? []) {
      const path = language === "en" ? "/blog/" : `/${language}/blog/`;
      expect(new URL(getWhatsNewBlogUrl(release, language)!).pathname).toContain(path);
    }
  });

  it("normalizes regional languages without creating unpublished routes", () => {
    const release = { blogUrl:"https://plainva.com/blog/plainva-0-8-2", blogLanguages:["en","de","pt-BR","zh-CN"] };
    expect(getWhatsNewBlogUrl(release, "de-AT")).toContain("/de/blog/");
    expect(getWhatsNewBlogUrl(release, "pt_BR")).toContain("/pt-BR/blog/");
    expect(getWhatsNewBlogUrl(release, "zh-Hans")).toContain("/zh-CN/blog/");
    expect(getWhatsNewBlogUrl(release, "fr")).toBe(release.blogUrl);
  });

  it("keeps historical posts on their existing translations and omits absent blogs", () => {
    const release = { blogUrl:"https://plainva.com/blog/plainva-0-8-1" };
    expect(getWhatsNewBlogUrl(release, "de")).toContain("/de/blog/");
    expect(getWhatsNewBlogUrl(release, "fr")).toBe(release.blogUrl);
    expect(getWhatsNewBlogUrl({}, "de")).toBeUndefined();
  });
});
