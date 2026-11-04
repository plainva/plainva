import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import { publicationErrorText, publicationPreviewNotices, publicationStatusText } from "@plainva/ui";
import { PUBLISHED_NOTE_REFUSED, PublishedNoteRefusedError, previewPublishedProjection } from "@plainva/core";
import { REPO } from "../test-sourceTree";

/**
 * A note a sanitized publication will not publish, said to the person
 * publishing (finding 2026-10-09).
 *
 * The sanitizer refuses a note whose block at the top cannot be read as
 * properties — text between two rules, a list, YAML that does not parse. The
 * allowlist judges names, and such a block has none. A refusal is only of use
 * if the person can act on it: a slice is many notes, so the sentence names
 * the one it is about, in the app's language. It is the same sentence
 * wherever the reason arrives — thrown out of the preview on either shell, or
 * read back from the publication's record on its row — because both shells
 * say it through `publicationErrorText`.
 *
 * Core runs for real; only the place the sentence is shown is left out here
 * (`publicationRefusalSurfaces.test.tsx` mounts both).
 */

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts ?? {});
const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"] as const;

/**
 * What the preview of a slice says about a note it goes past (open-items plan
 * 3.128 no. 1): the preview no longer ends at it, it names it beside the
 * numbers of the rest.
 */
function previewRefusal(): string | null {
  const preview = previewPublishedProjection({
    mode: "sanitized",
    objects: [
      { path: "Shared/Note.md", markdown: "---\ntitle: A\n---\nText." },
      { path: "Shared/Draft.md", markdown: "---\nSalary 4800, hidden-value\n---\nText." },
    ],
  });
  expect(preview.objectCount).toBe(1);
  return publicationPreviewNotices(preview, t).refused;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("a note the sanitizer refuses, said to the person publishing", () => {
  it("names the note the preview goes past, in words", () => {
    const said = previewRefusal() ?? "";
    expect(said).toBe(i18n.t("workspaceSecurity.publicationNotesRefused", { paths: "Shared/Draft.md" }));
    expect(said).toContain("Shared/Draft.md");
    expect(said).toMatch(/cannot be read as properties/);
    expect(said).toMatch(/the other notes are published/);
    // Not the protocol's own sentence, and nothing the note says.
    expect(said).not.toContain("frontmatter is invalid");
    expect(said).not.toContain("hidden-value");
    expect(said).not.toContain("4800");
  });

  it("says the same on the publication's row, read back from its record - every note the refresh went past", () => {
    // After a refresh nobody watched, the reason is the text the record kept.
    // The refresh went past the notes and published the rest: the row names
    // them and does not call the refresh failed.
    const kept = new PublishedNoteRefusedError(["Shared/Draft.md", "Shared/Broken.md"]).message;
    expect(previewRefusal()).toBe(publicationErrorText(`${PUBLISHED_NOTE_REFUSED}Shared/Draft.md`, t));
    const row = publicationStatusText({ lastError: kept, pending: 3 }, t);
    expect(row).toBe(i18n.t("workspaceSecurity.publicationNotesRefused", { paths: "Shared/Draft.md, Shared/Broken.md" }));
    expect(row).not.toContain(i18n.t("workspaceSecurity.publicationRefreshFailed", { reason: "" }).trim());
    expect(row).not.toContain("frontmatter is invalid");
    // A record written before a reason could name several reads the same.
    expect(publicationErrorText(`${PUBLISHED_NOTE_REFUSED}Shared/Old.md`, t)).toContain("Shared/Old.md");
    // Any other reason is still a failed refresh.
    expect(publicationStatusText({ lastError: "provider rejected the upload", pending: 3 }, t))
      .toBe(i18n.t("workspaceSecurity.publicationRefreshFailed", { reason: "provider rejected the upload" }));
  });

  it("names the files a sanitized copy leaves out because they are no notes", () => {
    const preview = previewPublishedProjection({
      mode: "sanitized",
      objects: [
        { path: "Shared/Note.md", markdown: "Text." },
        { path: "Shared/data.json", markdown: "{}" },
      ],
    });
    expect(publicationPreviewNotices(preview, t)).toEqual({
      refused: null,
      leftOut: i18n.t("workspaceSecurity.projectionLeftOut", { paths: "Shared/data.json" }),
    });
  });

  it("shows the path as it is written", () => {
    // An interpolation that escaped for HTML would turn the slash and the
    // ampersand of a path into entities.
    const path = "Projekte & Pläne/Q3 <Entwurf>.md";
    expect(publicationErrorText(new PublishedNoteRefusedError(path), t)).toContain(path);
  });

  it("speaks the user's language", async () => {
    await i18n.changeLanguage("de");
    const said = previewRefusal() ?? "";
    expect(said).toContain("Shared/Draft.md");
    expect(said).toMatch(/nicht als Eigenschaften lesen lässt/);
    expect(said).not.toContain("frontmatter is invalid");
  });

  it("has the sentence in every language, with the note in it", () => {
    for (const lang of LANGS) {
      const bundle = JSON.parse(readFileSync(join(REPO, "packages", "ui", "src", "locales", `${lang}.json`), "utf8")) as {
        workspaceSecurity?: Record<string, unknown>;
      };
      expect(bundle.workspaceSecurity?.publicationNotesRefused, `${lang} must name the notes`).toContain("{{paths}}");
      expect(bundle.workspaceSecurity?.projectionLeftOut, `${lang} must name the files`).toContain("{{paths}}");
    }
  });

  it("leaves a reason it does not know as it came, and a code it knows a sentence", () => {
    expect(publicationErrorText(new Error("provider rejected the upload"), t)).toBe("provider rejected the upload");
    expect(publicationErrorText(new Error("publication-key-missing"), t)).toBe(i18n.t("workspaceSecurity.publicationKeyMissing"));
  });
});
