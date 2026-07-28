import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import { docsSlug, userGuideUrl, GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE } from "@plainva/ui";
import { APP_LANGUAGES } from "@plainva/ui";

/**
 * The in-app help links point at plainva.com. Two things can silently break
 * them, and neither shows up as a compile error:
 *
 *  1. the slug rule drifting away from the website's generator, and
 *  2. a page name that no longer exists in the handbook.
 *
 * Both produce a 404 in a dialog nobody clicks during development.
 */

const HANDBOOK = join(__dirname, "..", "..", "..", "docs", "user");

/** Every page the app links to, as it is named in the handbook. */
const LINKED_PAGES = ["OKF.md", "Getting_Started.md", GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE];

describe("docsLinks", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("maps a handbook file name to the website slug", () => {
    expect(docsSlug("OKF.md")).toBe("okf");
    expect(docsSlug("Getting_Started.md")).toBe("getting-started");
    expect(docsSlug("OneDrive_and_Dropbox_BYO_Guide.md")).toBe("onedrive-and-dropbox-byo-guide");
    // README is the section index, so it has no slug of its own.
    expect(docsSlug("README.md")).toBe("");
  });

  it("puts English at the root and every other language under its code", async () => {
    expect(userGuideUrl("OKF.md")).toBe("https://plainva.com/docs/okf");

    await i18n.changeLanguage("de");
    expect(userGuideUrl("OKF.md")).toBe("https://plainva.com/de/docs/okf");

    await i18n.changeLanguage("pt-BR");
    expect(userGuideUrl("Getting_Started.md")).toBe("https://plainva.com/pt-BR/docs/getting-started");

    // A language the site does not know falls back to English, never to a
    // prefix that was never built.
    await i18n.changeLanguage("xx");
    expect(userGuideUrl("OKF.md")).toBe("https://plainva.com/docs/okf");
  });

  it("links only to pages that exist in every language of the handbook", () => {
    const langs = APP_LANGUAGES.map((l) => l.code);
    for (const lang of langs) {
      for (const page of LINKED_PAGES) {
        expect(
          existsSync(join(HANDBOOK, lang, page)),
          `${lang}/${page} is linked from the app but missing in the handbook`,
        ).toBe(true);
      }
    }
  });

  it("covers every handbook language the app can be set to", () => {
    const onDisk = readdirSync(HANDBOOK, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const inApp = APP_LANGUAGES.map((l) => l.code).sort();
    expect(onDisk).toEqual(inApp);
  });
});
