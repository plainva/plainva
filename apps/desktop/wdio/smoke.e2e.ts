import { browser, $ } from "@wdio/globals";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The single native smoke (WebDriver_Smoke.md, kept tiny and boring): launch ->
 * the throwaway vault auto-opens -> create a note -> type a marker -> autosave ->
 * the marker is in the file on disk. That one flow exercises window creation,
 * the real fs plugin, the atomic write command and the SQLite index. OS dialogs
 * (print, keychain, folder picker) cannot be driven by WebDriver and stay in
 * the manual section of the Release Gate Checklist.
 *
 * The proof is the FILE, read by this process, not the window after a restart.
 * Until 2026-10-06 the spec restarted the app (`browser.reloadSession()`) and
 * looked for the marker in the reopened note; on the first run that got that
 * far the restart never came back and the test spent its three minutes there.
 * Why is not known — a second launch meeting the single-instance lock of the
 * first is the suspicion, not a finding. What the restart added, session
 * restore, is covered by the mocked suites; what only a native run can show
 * is that the bytes reach the disk, and that is what is asserted here.
 */
describe("Plainva native smoke", () => {
  const marker = `smoke-marker-${Date.now()}`;

  it("writes a typed note to the vault on disk", async () => {
    const vault = process.env.PLAINVA_SMOKE_VAULT;
    if (!vault) throw new Error("PLAINVA_SMOKE_VAULT is not set (wdio.conf onPrepare)");

    // The store pre-seed (wdio.conf onPrepare) auto-opens the vault; wait for the
    // app shell (the ribbon is always present once a vault is open).
    await $('[data-testid="ribbon-tasks"]').waitForExist({ timeout: 40_000 });

    // A fresh profile greets with dialogs of its own (What's New at the
    // least), and a dialog over the ribbon takes the click (second Linux run,
    // 2026-10-06: "element click intercepted"). They close on Escape; three
    // rounds are more than a first start has ever shown.
    for (let round = 0; round < 3 && (await $('[role="dialog"]').isExisting()); round += 1) {
      await browser.keys("Escape");
      await browser.pause(400);
    }

    // By test id, like every other ribbon entry: the label follows the app's
    // language and the catalog's wording, the id does not (first Linux run,
    // 2026-09-30: the vault opened and the button was not found by its label).
    await $('[data-testid="ribbon-new"]').click();
    // "New note" asks for the name first, in a field in the file tree (third
    // Linux run, 2026-10-06: the click worked and no editor appeared — the
    // page source showed that field waiting). Name it, then the note opens.
    const name = await $('[data-testid="file-tree"] input.pv-field');
    await name.waitForExist({ timeout: 10_000 });
    await name.setValue("smoke-note");
    await browser.keys("Enter");

    const editor = await $(".cm-content");
    await editor.waitForExist({ timeout: 10_000 });
    await editor.click();
    // Sent to the element, not to "whatever has the focus": on WebKitGTK the
    // global key actions went nowhere (fifth run, 2026-10-06 — the note file
    // was created and stayed empty, while the same steps passed on Windows).
    await editor.addValue(marker);

    // Autosave runs about a second after the last key; give the atomic write
    // its time and then read what is actually in the vault.
    const file = join(vault, "smoke-note.md");
    await browser.waitUntil(() => existsSync(file) && readFileSync(file, "utf8").includes(marker), {
      timeout: 20_000,
      interval: 500,
      timeoutMsg: `the marker never reached ${file}; the vault holds: ${existsSync(vault) ? readdirSync(vault).join(", ") : "nothing"}`,
    });
  });
});
