import { browser, $ } from "@wdio/globals";

/**
 * The single native smoke (WebDriver_Smoke.md, kept tiny and boring): launch ->
 * the throwaway vault auto-opens -> create a note -> type a marker -> autosave ->
 * restart -> the marker is present again. That one flow exercises window
 * creation, the real fs plugin, the atomic write command, the SQLite index and
 * session restore. OS dialogs (print, keychain, folder picker) cannot be driven
 * by WebDriver and stay in the manual section of the Release Gate Checklist.
 *
 * NOTE (maintainer): selectors mirror the running app but are verified natively —
 * this spec has never run in the harness (no native build). Adjust here on the
 * first real run if a selector or the restart-reopens-the-note assumption drifts.
 */
describe("Plainva native smoke", () => {
  const marker = `smoke-marker-${Date.now()}`;

  it("keeps a typed note across a restart", async () => {
    // The store pre-seed (wdio.conf onPrepare) auto-opens the vault; wait for the
    // app shell (the ribbon is always present once a vault is open).
    await $('[data-testid="ribbon-tasks"]').waitForExist({ timeout: 40_000 });

    // New note, then type the marker into the editor.
    await $('button[aria-label="New note"], button[aria-label="Neue Notiz"]').click();
    const editor = await $(".cm-content");
    await editor.waitForExist({ timeout: 10_000 });
    await editor.click();
    await browser.keys(marker);

    // Let the ~1s autosave flush, then restart the app.
    await browser.pause(2_500);
    await browser.reloadSession();

    // After restart the vault reopens; the marker text must be present somewhere
    // in the reopened note (read or live view).
    await $(`*=${marker}`).waitForExist({ timeout: 40_000 });
  });
});
