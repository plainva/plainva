import { describe, it, expect, beforeEach, vi } from "vitest";
import { consumePendingTemplateCaret, clearPendingTemplateCaret } from "@plainva/ui";
import { applyTemplateInteractive, parkTemplateCaret } from "./templateInteractive";
import { dialogStore, settleDialog, type AnswersRequest } from "./appDialogs";

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => null }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

const ctx = { title: "Meine Notiz", now: new Date(2026, 6, 29, 14, 37) };

/** Answers the dialog the pipeline opens, as the user would. */
function answerNextDialog(answer: Record<string, string> | null): Promise<AnswersRequest> {
  return new Promise((resolve) => {
    const stop = dialogStore.subscribe(() => {
      const req = dialogStore.get();
      if (req?.type !== "answers") return;
      stop();
      resolve(req);
      settleDialog(req.id, answer);
    });
  });
}

describe("applyTemplateInteractive", () => {
  beforeEach(() => {
    dialogStore.clearAll();
    clearPendingTemplateCaret();
  });

  it("opens NO dialog for a template without questions", async () => {
    const opened = vi.fn();
    const stop = dialogStore.subscribe(opened);
    const result = await applyTemplateInteractive("# {{title}}\n{{date}}", ctx, "Fragen");
    stop();
    // Decision E3: creating an entry stays a single click unless the template
    // actually asks something.
    expect(opened).not.toHaveBeenCalled();
    expect(result?.text).toBe("# Meine Notiz\n2026-07-29");
  });

  it("asks every question of a template in ONE dialog", async () => {
    const seen = answerNextDialog({ Stimmung: "gut", Status: "Fertig" });
    const done = applyTemplateInteractive(
      "Stimmung: {{prompt:Stimmung|neutral}}\nStatus: {{select:Status|Offen,Fertig}}",
      ctx,
      "Fragen"
    );
    const req = await seen;
    expect(req.fields.map((f) => f.label)).toEqual(["Stimmung", "Status"]);
    expect(req.fields[0]).toMatchObject({ kind: "text", defaultValue: "neutral" });
    expect(req.fields[1]).toMatchObject({ kind: "select", options: ["Offen", "Fertig"] });
    expect((await done)?.text).toBe("Stimmung: gut\nStatus: Fertig");
  });

  it("returns null when the dialog is cancelled — the caller writes nothing", async () => {
    const seen = answerNextDialog(null);
    const done = applyTemplateInteractive("{{prompt:X}}", ctx, "Fragen");
    await seen;
    expect(await done).toBeNull();
  });

  it("hands back the caret offset from {{cursor}}", async () => {
    const result = await applyTemplateInteractive("# {{title}}\n\n{{cursor}}Text", ctx, "Fragen");
    expect(result?.cursor).toBe("# Meine Notiz\n\n".length);
  });
});

describe("parkTemplateCaret", () => {
  beforeEach(() => clearPendingTemplateCaret());

  it("shifts the offset by whatever the write path put in front", () => {
    // The offset is measured in the template body; the file starts with OKF
    // frontmatter, so the caret has to move by its length.
    parkTemplateCaret("Notes/A.md", 5, 42);
    expect(consumePendingTemplateCaret("Notes/A.md")).toEqual({ path: "Notes/A.md", offset: 47 });
  });

  it("parks nothing when the template had no cursor marker", () => {
    parkTemplateCaret("Notes/A.md", null, 42);
    expect(consumePendingTemplateCaret("Notes/A.md")).toBeNull();
  });

  it("hands the caret only to the note it was parked for, and only once", () => {
    parkTemplateCaret("Notes/A.md", 1);
    expect(consumePendingTemplateCaret("Notes/B.md")).toBeNull();
    expect(consumePendingTemplateCaret("Notes/A.md")).not.toBeNull();
    expect(consumePendingTemplateCaret("Notes/A.md")).toBeNull();
  });
});

describe("the background paths stay dialog-free", () => {
  it("no module that creates notes in the background reaches for the dialog", async () => {
    // taskSync (worker cycle), taskPromotion (batch) and the mail capture must
    // never open a modal: they run without anyone watching. They build content
    // through buildNewItemContent → applyTemplatePlaceholders, which is
    // headless by construction. This pins that they do not import the
    // interactive pipeline — the drift this test exists to catch.
    const fs = await import("node:fs/promises");
    // These name the REAL modules in `packages/ui`, not the desktop
    // re-export stubs: a stub contains no logic, so pointing the scan at one
    // would leave this guard green while checking nothing.
    const files = [
      "../../../../packages/ui/src/pim/taskSync.ts",
      "../../../../packages/ui/src/lib/taskPromotion.ts",
      "../../../../packages/ui/src/mail/mailCapture.ts",
    ];
    for (const file of files) {
      const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} must not use the interactive template pipeline`).not.toMatch(
        /applyTemplateInteractive|appTemplateAnswers/
      );
    }
  });
});
