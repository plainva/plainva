// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { previewPublishedProjection, type PublishedProjectionPreview, type PublishedSliceMode } from "@plainva/core";
import { publicationErrorText } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";
import { WorkspaceGovernanceDialog } from "./components/security/WorkspaceGovernanceDialog";
import type { GovernanceForm } from "./components/security/securityForms";
import { PublishSliceSheet } from "../../mobile/src/components/PublishSliceSheet";

/**
 * Where a publisher is told that a note cannot be published, on both shells
 * (finding 2026-10-09).
 *
 * A sanitized publication refuses a note whose block at the top cannot be read
 * as properties. It goes past that note and publishes the rest (open-items
 * plan 3.128 no. 1), so the preview shows the numbers of the rest and both
 * shells say the same sentence beside them, naming every such note — the
 * review step of the desktop's wizard, the answer of the phone's sheet. The
 * text files a sanitized copy leaves out because they are no notes (no. 2)
 * are named there too.
 *
 * Before, the preview ended at the first such note; before that, the desktop
 * said it in a toast and the review step went on reading "Reading the covered
 * notes…" for good, and the phone showed the thrown message as it came.
 */

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const count = vars?.count;
      const lookup = (k: string) => k.split(".").reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], data);
      const value = (typeof count === "number" ? lookup(`${key}_${count === 1 ? "one" : "other"}`) : undefined) ?? lookup(key);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./contexts/VaultContext", () => ({ useVault: () => ({ vaultAdapter: null }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); } });

async function mount(ui: ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(ui); });
  return host;
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element, "the control to click is on the page").toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  // What the click started - a preview that is read, a publication that is made - settles a turn later.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const DRAFT = { path: "Shared/Draft.md", markdown: "---\nSalary 4800, hidden-value\n---\nText." };
const DATA = { path: "Shared/data.json", markdown: '{ "see": "[[Private/Plan]]" }' };
const CLEAN = { path: "Shared/Note.md", markdown: "---\ntitle: A\nbudget_eur: 1\n---\nText." };

/** The real preview of core over a slice. */
function previewOf(objects: Array<{ path: string; markdown: string }>): PublishedProjectionPreview {
  return previewPublishedProjection({ mode: "sanitized", objects });
}

/** The sentences both shells have to show, as the English catalogue has them. */
const SENTENCE = String(en.workspaceSecurity.publicationNotesRefused).split("{{paths}}").join(DRAFT.path);
const LEFT_OUT = String(en.workspaceSecurity.projectionLeftOut).split("{{paths}}").join(DATA.path);
const t = (key: string, vars?: Record<string, unknown>) => {
  const value = key.split(".").reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], en);
  return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
};

describe("the sentence itself", () => {
  it("names the note and none of its words", () => {
    const preview = previewOf([CLEAN, DRAFT]);
    expect(preview.refused).toEqual([DRAFT.path]);
    expect(publicationErrorText(new Error(`published note frontmatter is invalid: ${DRAFT.path}`), t)).toBe(SENTENCE);
    expect(SENTENCE).toContain("Shared/Draft.md");
    expect(SENTENCE).not.toContain("hidden-value");
  });
});

describe("desktop: the review step of the slice wizard", () => {
  const FORM: GovernanceForm = {
    code: "", name: "Shared", role: "Reader", members: "", scopeKind: "workspace", scopeId: "", sliceKind: "folder", definition: "Shared",
    publicationMode: "sanitized", publicationAccess: "read", publicationProvider: "webdav", recoveryCode: "", deviceName: "Desktop", recoveryFile: "", fallbackPassphrase: "",
  };

  async function reviewStep(over: { publicationPreview?: PublishedProjectionPreview | null; publicationPreviewError?: string | null }) {
    const onPublicationPreview = vi.fn();
    const host = await mount(
      <WorkspaceGovernanceDialog
        kind="slice" busy={false} form={FORM} governance={null} pairPreview={null}
        slicePreview={[{ objectId: "ab".repeat(16), path: DRAFT.path }]}
        publicationPreview={over.publicationPreview ?? null}
        publicationPreviewError={over.publicationPreviewError ?? null}
        sliceObjects={[]} rotatedRecoveryCode={null}
        setForm={() => {}} onClose={() => {}} onPreview={() => {}} onPublicationPreview={onPublicationPreview} onSubmit={() => {}}
      />,
    );
    // Details → Content → Permissions → Review.
    for (let step = 1; step < 4; step++) {
      // The step's own button stands last in the row, behind Cancel or Back.
      const row = host.querySelectorAll(".pv-security-actions button");
      await click(row[row.length - 1]);
    }
    return { host, onPublicationPreview };
  }

  it("says why there is no preview, where the numbers would stand", async () => {
    const { host, onPublicationPreview } = await reviewStep({ publicationPreviewError: "Shared/Note.md could not be read" });
    // The preview was asked for on the way out of the decision step …
    expect(onPublicationPreview).toHaveBeenCalledTimes(1);
    // … and its failure is on the page, not the promise that notes are being read.
    expect(host.textContent).toContain("Shared/Note.md could not be read");
    expect(host.textContent).not.toContain(en.workspaceSecurity.projectionLoading);
    expect(host.querySelector(".pv-security-preview")).toBeNull();
  });

  it("shows the rest and names the note it goes past and the file it leaves out", async () => {
    const { host } = await reviewStep({ publicationPreview: previewOf([CLEAN, DRAFT, DATA]) });
    expect(host.textContent).toContain(SENTENCE);
    expect(host.textContent).toContain(LEFT_OUT);
    expect(host.textContent).not.toContain("hidden-value");
    expect(host.querySelector(".pv-security-preview")?.textContent).toContain(CLEAN.path);
  });

  it("says that it is reading for as long as there is neither an answer nor a reason", async () => {
    const { host } = await reviewStep({});
    expect(host.textContent).toContain(en.workspaceSecurity.projectionLoading);
  });

  it("shows the answer where there is one", async () => {
    const { host } = await reviewStep({ publicationPreview: previewOf([CLEAN]) });
    expect(host.textContent).not.toContain(en.workspaceSecurity.projectionLoading);
    expect(host.textContent).toContain(en.workspaceSecurity.projectionRemovedProperties);
    expect(host.querySelector(".pv-security-preview")?.textContent).toContain(CLEAN.path);
  });
});

describe("phone: the sheet that publishes a slice", () => {
  async function sheet(over: { onPreview?: (mode: PublishedSliceMode) => Promise<PublishedProjectionPreview>; onSubmit?: () => Promise<void> }) {
    return mount(
      <PublishSliceSheet
        sliceName="Shared"
        onClose={() => {}}
        onPreview={over.onPreview ?? (async () => previewOf([CLEAN]))}
        onSubmit={over.onSubmit ?? (async () => {})}
      />,
    );
  }

  it("shows the rest and names the note the preview goes past, in words", async () => {
    const host = await sheet({ onPreview: async () => previewOf([CLEAN, DRAFT, DATA]) });
    await click(host.querySelector('[data-testid="publish-preview"]'));
    const result = host.querySelector('[data-testid="publish-preview-result"]');
    expect(result?.textContent).toContain(SENTENCE);
    expect(result?.textContent).toContain(LEFT_OUT);
    expect(result?.textContent).toContain(CLEAN.path);
    // Neither the protocol's sentence nor anything the note says.
    expect(host.textContent).not.toContain("frontmatter is invalid");
    expect(host.textContent).not.toContain("hidden-value");
  });

  it("keeps the names with the mode they were asked in", async () => {
    // An exact copy hands every file out as it is: what the sanitized copy
    // goes past or leaves out is its answer alone.
    const host = await sheet({ onPreview: async (mode) => previewPublishedProjection({ mode, objects: [CLEAN, DRAFT, DATA] }) });
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.textContent).toContain(SENTENCE);
    await click(host.querySelector('[data-testid="publish-mode-exact"]'));
    expect(host.textContent).not.toContain(SENTENCE);
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.querySelector('[data-testid="publish-preview-result"]')).not.toBeNull();
    expect(host.textContent).not.toContain(SENTENCE);
    expect(host.textContent).not.toContain(LEFT_OUT);
    // Back to the sanitized copy, the exact copy's answer is not its answer.
    await click(host.querySelector('[data-testid="publish-mode-sanitized"]'));
    expect(host.querySelector('[data-testid="publish-preview-result"]')).toBeNull();
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.textContent).toContain(SENTENCE);
    expect(host.textContent).toContain(LEFT_OUT);
  });

  it("says a failure that is not about a note in every mode, and keeps no answer it stopped", async () => {
    // A note that cannot be read stops the preview of an exact copy as well as
    // of a sanitized one. The numbers asked for before it would be numbers for
    // a reading that no longer goes through.
    let unreadable = false;
    const host = await sheet({
      onPreview: async (mode) => {
        if (unreadable) throw new Error("Shared/Note.md could not be read");
        return previewPublishedProjection({ mode, objects: [CLEAN] });
      },
    });
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.querySelector('[data-testid="publish-preview-result"]')).not.toBeNull();

    unreadable = true;
    await click(host.querySelector('[data-testid="publish-mode-exact"]'));
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.textContent).toContain("could not be read");
    await click(host.querySelector('[data-testid="publish-mode-sanitized"]'));
    expect(host.textContent).toContain("could not be read");
    expect(host.querySelector('[data-testid="publish-preview-result"]')).toBeNull();
  });

  it("says a publication's error code as a sentence, like the desktop", async () => {
    const host = await sheet({ onSubmit: async () => { throw new Error("workspace-publication-not-permitted"); } });
    await click(host.querySelector('[data-testid="publish-slice-submit"]'));
    expect(host.textContent).toContain(en.workspaceSecurity.publicationNotPermitted);
    expect(host.textContent).not.toContain("workspace-publication-not-permitted");
  });
});
