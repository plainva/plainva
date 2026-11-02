import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every desktop dialog that holds what the person types asks before it closes
 * over it (finding 2026-10-22, Sammelplan 3.139 Nr. 3) — the twin of the
 * phone's sheet rule in apps/mobile/src/leaveGuardCoverage.test.ts.
 *
 * Read from the files: a file that draws a `Modal` and a field either passes
 * `unsaved={…}` to it or closes through `useDiscardGuard(…)`, or stands below
 * with the reason a close loses nothing typed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "../../../packages/ui/src");

const DIALOGS_WITHOUT_TYPED_INPUT: Record<string, string> = {
  "apps/desktop/src/components/HailingFrequenciesModal.tsx": "an easter egg: a line to try, kept after a miss so the next try can change it - not work",
  "apps/desktop/src/components/ShortcutsModal.tsx": "the field filters the list of shortcuts",
  "apps/desktop/src/components/TemplateTargetsModal.tsx": "the field filters the list of targets",
  "apps/desktop/src/components/VaultFindReplaceModal.tsx": "find and replace terms are a search, typed again in a moment",
  "apps/desktop/src/components/base/PinboardEntryModal.tsx": "the entry is a draft note on disk; closing keeps it, Discard asks itself",
  "apps/desktop/src/components/ui/DialogHost.tsx": "a prompt's Cancel is its answer to the question that opened it",
  "apps/desktop/src/components/import/ImportWizardModal.tsx": "a proposed subfolder and a token asked for this one run; the rest are picks",
  "apps/desktop/src/components/OkfConversionModal.tsx": "two proposed settings, nothing the person wrote",
  "apps/desktop/src/components/ImageViewer.tsx": "Save As and Resize fields are proposals filled in by Plainva, answered like a prompt",
};

describe("dialog guard coverage", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const FIELD = /<(TextInput|TextArea|GrowingField|MentionTextArea|JournalCaptureField|TaskCaptureField|PropertyNameInput|SearchField|ChipField|input|textarea)\b/;
  const root = join(here, "../../..");
  const dialogs = [...walk(here), ...walk(ui)]
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => [relative(root, f).split(sep).join("/"), readFileSync(f, "utf8")] as const)
    .filter(([, src]) => /<Modal\b/.test(src) && FIELD.test(src));

  it("finds the dialogs it is about", () => {
    expect(dialogs.map(([f]) => f)).toEqual(
      expect.arrayContaining(["apps/desktop/src/components/journal/JournalCaptureDialog.tsx", "apps/desktop/src/components/pimcal/EventEditModal.tsx"]),
    );
  });

  for (const [f, src] of dialogs) {
    it(`${f} asks before a close takes what was typed`, () => {
      const guarded = /\bunsaved=\{|\buseDiscardGuard\(/.test(src);
      expect(guarded || f in DIALOGS_WITHOUT_TYPED_INPUT, `${f} draws a dialog with a field and neither guards it nor says why not`).toBe(true);
      expect(guarded && f in DIALOGS_WITHOUT_TYPED_INPUT, `${f} is guarded now: take it off the exemption list`).toBe(false);
    });
  }

  it("the desktop registers the question in every window and in the tests", () => {
    expect(readFileSync(join(here, "main.tsx"), "utf8")).toMatch(/installDiscardQuestion\(\)/);
    expect(readFileSync(join(here, "services/discardQuestionInstall.ts"), "utf8")).toMatch(/registerDiscardQuestion\(desktopDiscardHost\)/);
    expect(readFileSync(join(here, "test-setup.ts"), "utf8")).toMatch(/registerDiscardQuestion\(desktopDiscardHost\)/);
  });
});
