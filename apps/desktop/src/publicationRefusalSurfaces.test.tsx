// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { previewPublishedProjection, type PublishedProjectionPreview } from "@plainva/core";
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
 * as properties, and the preview ends at that note. Both shells then say the
 * same sentence in the same place: where the preview's numbers would stand —
 * the review step of the desktop's wizard, the banner of the phone's sheet —,
 * and it stays there.
 *
 * Before, the desktop said it in a toast and the review step went on reading
 * "Reading the covered notes…" for good; the phone showed the thrown message
 * as it came, protocol sentence or error code.
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
const CLEAN = { path: "Shared/Note.md", markdown: "---\ntitle: A\nbudget_eur: 1\n---\nText." };

/** The real preview of core over a slice: its answer, or what it throws. */
function previewOf(objects: Array<{ path: string; markdown: string }>): PublishedProjectionPreview {
  return previewPublishedProjection({ mode: "sanitized", objects });
}

/** The sentence both shells have to show, as the English catalogue has it. */
const SENTENCE = String(en.workspaceSecurity.publicationNoteRefused).split("{{path}}").join(DRAFT.path);
const t = (key: string, vars?: Record<string, unknown>) => {
  const value = key.split(".").reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], en);
  return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
};

describe("the sentence itself", () => {
  it("names the note and none of its words", () => {
    let refusal: unknown = null;
    try { previewOf([CLEAN, DRAFT]); } catch (error) { refusal = error; }
    expect(publicationErrorText(refusal, t)).toBe(SENTENCE);
    expect(SENTENCE).toContain("“Shared/Draft.md”");
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
    const { host, onPublicationPreview } = await reviewStep({ publicationPreviewError: SENTENCE });
    // The preview was asked for on the way out of the decision step …
    expect(onPublicationPreview).toHaveBeenCalledTimes(1);
    // … and its refusal is on the page, not the promise that notes are being read.
    expect(host.textContent).toContain(SENTENCE);
    expect(host.textContent).not.toContain(en.workspaceSecurity.projectionLoading);
    expect(host.querySelector(".pv-security-preview")).toBeNull();
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
  async function sheet(over: { onPreview?: () => Promise<PublishedProjectionPreview>; onSubmit?: () => Promise<void> }) {
    return mount(
      <PublishSliceSheet
        sliceName="Shared"
        onClose={() => {}}
        onPreview={over.onPreview ?? (async () => previewOf([CLEAN]))}
        onSubmit={over.onSubmit ?? (async () => {})}
      />,
    );
  }

  it("names the note the preview stopped at, in words", async () => {
    const host = await sheet({ onPreview: async () => previewOf([CLEAN, DRAFT]) });
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.textContent).toContain(SENTENCE);
    // Neither the protocol's sentence nor anything the note says.
    expect(host.textContent).not.toContain("frontmatter is invalid");
    expect(host.textContent).not.toContain("hidden-value");
    expect(host.querySelector('[data-testid="publish-preview-result"]')).toBeNull();
  });

  it("takes an earlier answer back when the next reading is refused", async () => {
    // Numbers beside the reason why there are none would be numbers for a
    // publication that does not come about.
    let notes = [CLEAN];
    const host = await sheet({ onPreview: async () => previewOf(notes) });
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.querySelector('[data-testid="publish-preview-result"]')?.textContent).toContain(CLEAN.path);

    notes = [CLEAN, DRAFT];
    await click(host.querySelector('[data-testid="publish-preview"]'));
    expect(host.querySelector('[data-testid="publish-preview-result"]')).toBeNull();
    expect(host.textContent).toContain(SENTENCE);
  });

  it("says a publication's error code as a sentence, like the desktop", async () => {
    const host = await sheet({ onSubmit: async () => { throw new Error("workspace-publication-not-permitted"); } });
    await click(host.querySelector('[data-testid="publish-slice-submit"]'));
    expect(host.textContent).toContain(en.workspaceSecurity.publicationNotPermitted);
    expect(host.textContent).not.toContain("workspace-publication-not-permitted");
  });
});
