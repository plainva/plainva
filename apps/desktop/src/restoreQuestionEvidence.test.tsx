// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { mkdirSync, writeFileSync } from "node:fs";
import i18n from "i18next";
import { DialogHost } from "./components/ui/DialogHost";
import { appConfirm } from "./services/appDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Evidence markup for R8 (run with PLAINVA_EVIDENCE_HTML=<folder>): the
 * desktop's question before restoring from the recovery file, as the shell's
 * own dialog host renders it, with the call `SecuritySharingPage` makes. The
 * mock shell reaches no workspace, so the dialog is opened directly; the
 * markup is drawn with the built stylesheet afterwards. Skipped in a normal run.
 */
const OUT = process.env.PLAINVA_EVIDENCE_HTML;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });

describe.skipIf(!OUT)("evidence markup of the desktop's restore question (R8)", () => {
  it("asks before restoring", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<DialogHost />); });
    await act(async () => {
      void appConfirm({
        title: i18n.t("workspaceSecurity.restoreRevokesTitle"),
        message: i18n.t("workspaceSecurity.restoreRevokesBody"),
        kind: "danger",
        confirmLabel: i18n.t("workspaceSecurity.restore", { defaultValue: "Restore access" }),
      });
    });
    expect(document.body.textContent).toContain("every other device");
    mkdirSync(OUT!, { recursive: true });
    writeFileSync(`${OUT}/d-restore-question.html`, document.body.innerHTML, "utf8");
  });
});
