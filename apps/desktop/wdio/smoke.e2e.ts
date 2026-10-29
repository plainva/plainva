import { browser, $ } from "@wdio/globals";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as mac from "./macos";

/**
 * The native smoke (WebDriver_Smoke.md, kept small and boring). One session,
 * the cases in order; what can run on all three systems runs on all three —
 * the same promise for the checks as for the product.
 *
 *  S1  the app starts and the throwaway vault opens
 *  S2  a new note, a typed marker, the marker IN THE FILE on disk
 *  S3  spell checking: the editor is marked for the platform's checker, and on
 *      macOS the WebView's own setting is on (issue #135 — the attribute alone
 *      did nothing there)
 *  S4a the quick capture shortcut is switched on and recorded — on macOS with a
 *      REAL click on the recorder and real keys (issue #123: a clicked button
 *      gets no focus in WebKit there, which the driver's synthetic click, with
 *      its forced focus, never shows)
 *  S4b macOS: with the Finder in front, the recorded shortcut pressed for real
 *      opens the capture window — the system-wide key reaches the app
 *  S5  the note moves into a second window, which shows it and writes to the
 *      file (#86: the second window had never run under a suite)
 *
 * OS dialogs (print, keychain, folder picker) cannot be driven by WebDriver and
 * stay in the manual section of the Release Gate Checklist. Neither does it
 * restart the app: the proof of S2 and S5 is the FILE, read by this process.
 * Until 2026-10-06 the spec restarted the app (`browser.reloadSession()`) and
 * the restart never came back — a second launch meeting the single-instance
 * lock of the first is the suspicion, not a finding; session restore is
 * covered by the mocked suites.
 *
 * Labels come from the English catalog (the runners' system language), read
 * from the one source both shells use, so a reworded label moves the spec with
 * it. Test ids where the app has them.
 */

const isMac = process.platform === "darwin";
const en = JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/ui/src/locales/en.json"), "utf8")) as {
  shortcuts: { openSettings: string };
  settings: { sectionBehavior: string };
  common: { close: string };
  quickCapture: { section: string; recording: string; failedTaken: string; failedInvalid: string };
};

// WebDriver's codes for the modifier keys in Element Send Keys (W3C §17.4.2).
const CTRL = String.fromCharCode(0xe009);
const ALT = String.fromCharCode(0xe00a);
const ENTER = String.fromCharCode(0xe007);

/** How the settings show Control+Alt+K: `⌃ + ⌥ + K` on a Mac, `Ctrl + Alt + K` elsewhere. */
const recordedLabel = isMac ? `${String.fromCharCode(0x2303)} + ${String.fromCharCode(0x2325)} + K` : "Ctrl + Alt + K";
const CAPTURE_WINDOW = "capture-main";

async function dismissDialogs(): Promise<void> {
  // A fresh profile greets with dialogs of its own (What's New at the least),
  // and a dialog over the ribbon takes the click (second Linux run,
  // 2026-10-06: "element click intercepted"). They close on Escape; three
  // rounds are more than a first start has ever shown.
  for (let round = 0; round < 3 && (await $('[role="dialog"]').isExisting()); round += 1) {
    await browser.keys("Escape");
    await browser.pause(400);
  }
}

/** Closes an open dialog by its close button, Escape as the second way. */
async function closeDialog(): Promise<void> {
  const close = $(`[role="dialog"] button[aria-label="${en.common.close}"]`);
  if (await close.isExisting()) await close.click();
  await dismissDialogs();
}

/** Where an element's centre is on the screen, in points (macOS only — for a real click). */
async function screenCentre(selector: string): Promise<{ x: number; y: number }> {
  const box = await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, innerHeight: window.innerHeight };
  }, selector);
  if (!box) throw new Error(`no element for ${selector}`);
  mac.activatePlainva();
  const frame = mac.frontWindowFrame();
  // The window draws under a transparent title bar (titleBarStyle Overlay), so
  // the page starts at the window's top edge; should a title bar take room,
  // it is the difference between the window and the page.
  const titleBar = Math.max(0, frame.height - box.innerHeight);
  return { x: Math.round(frame.x + box.left + box.width / 2), y: Math.round(frame.y + titleBar + box.top + box.height / 2) };
}

/**
 * Types into the editor of the current window, at the end of the note.
 *
 * Linux and Windows: to the element through the driver — on WebKitGTK the
 * global key actions went nowhere (fifth run, 2026-10-06), the element's own
 * did. macOS: for real, a click into the editor, Cmd+Down to the end of the
 * note and typed keys through System Events. The embedded driver's synthetic
 * text (`execCommand('insertText')`) reached CodeMirror in one run and not in
 * the next, in the main window and in the second (2026-10-29), so it proves
 * nothing either way there.
 */
async function typeIntoEditor(text: string): Promise<void> {
  const editor = $(".cm-content");
  if (isMac) {
    const at = await screenCentre(".cm-content");
    mac.clickAt(at.x, at.y);
    mac.keyCode(125, ["command"]);
    mac.typeText(text);
    return;
  }
  await editor.click();
  await editor.addValue(text);
}

/** The app's own list of its windows, for a failure message: what exists, whether the driver sees it or not. */
async function appWindows(): Promise<string> {
  try {
    const labels = await browser.execute(async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      return internals ? await internals.invoke("plugin:window|get_all_windows") : "no Tauri internals";
    });
    return JSON.stringify(labels);
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`;
  }
}

/**
 * `browser.waitUntil` whose failure message is written when it fails, not when
 * the wait starts — "now" in a message has to be the state at the timeout.
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number,
  explain: () => string | Promise<string>,
  interval = 500,
): Promise<void> {
  try {
    await browser.waitUntil(condition, { timeout, interval });
  } catch (error) {
    throw new Error(`${await explain()} [${error instanceof Error ? error.message : String(error)}]`, { cause: error });
  }
}

function fileHolds(file: string, text: string): boolean {
  return existsSync(file) && readFileSync(file, "utf8").includes(text);
}

describe("Plainva native smoke", () => {
  const marker = `smoke-marker-${Date.now()}`;
  const secondMarker = `second-window-${Date.now()}`;
  let vault = "";
  let mainHandle = "";
  const note = () => join(vault, "smoke-note.md");

  before(() => {
    vault = process.env.PLAINVA_SMOKE_VAULT ?? "";
    if (!vault) throw new Error("PLAINVA_SMOKE_VAULT is not set (wdio.conf onPrepare)");
  });

  it("S1 starts and opens the vault", async () => {
    // The store pre-seed (wdio.conf onPrepare) auto-opens the vault; the ribbon
    // is always present once a vault is open.
    await $('[data-testid="ribbon-tasks"]').waitForExist({ timeout: 60_000 });
    mainHandle = await browser.getWindowHandle();
    // An explicit switch tells the service that this spec chooses its window
    // itself. Without it the service looks for the active window before every
    // find and click, through a helper plugin this app does not carry, and
    // waits five seconds for it each time (first run with S4, 2026-10-29: the
    // case ran out of its three minutes on that alone).
    await browser.switchToWindow(mainHandle);
    // A person's app is in front; one started by the service is not
    // necessarily (macOS: the name field of S2 never heard its Enter in a
    // window that was not key, 2026-10-29).
    if (isMac) mac.activatePlainva();
    await dismissDialogs();
  });

  it("S2 writes a typed note to the vault on disk", async () => {
    // By test id, like every other ribbon entry: the label follows the app's
    // language and the catalog's wording, the id does not.
    await $('[data-testid="ribbon-new"]').click();
    // "New note" asks for the name first, in a field in the file tree.
    const name = $('[data-testid="file-tree"] input.pv-field');
    await name.waitForExist({ timeout: 10_000 });
    await name.setValue("smoke-note");
    if (isMac) {
      // The name field is a form, and a form submits on Enter only for a
      // trusted key: the embedded driver's synthetic Enter reached the field
      // and submitted nothing (2026-10-29, twice). A real Return does.
      mac.activatePlainva();
      mac.pressReturn();
    } else {
      // To the field itself, like the marker below.
      await name.addValue(ENTER);
    }

    const editor = $(".cm-content");
    await editor.waitForExist({ timeout: 10_000 });
    await typeIntoEditor(marker);

    // Autosave runs about a second after the last key; give the atomic write
    // its time and then read what is actually in the vault.
    await waitFor(
      () => fileHolds(note(), marker),
      20_000,
      () => `the marker never reached ${note()}; the vault holds: ${existsSync(vault) ? readdirSync(vault).join(", ") : "nothing"}`,
    );
  });

  it("S3 hands the editor to the platform's spell checker", async () => {
    // The device switch is on (wdio.conf seeds it); the editor follows it.
    await browser.waitUntil(async () => (await $(".cm-content").getAttribute("spellcheck")) === "true", {
      timeout: 10_000,
      timeoutMsg: 'the editor never carried spellcheck="true" with the device switch on',
    });
    if (isMac) {
      // WKWebView marks only while its own setting is on (issue #135); the app
      // sets it at the first start, in the defaults of its bundle identifier.
      const value = mac.readDefault("WebContinuousSpellCheckingEnabled");
      if (value !== "1") {
        throw new Error(`defaults read ${mac.APP_ID} WebContinuousSpellCheckingEnabled gave ${value === null ? "nothing (not set)" : `"${value}"`}, expected 1`);
      }
    }
  });

  it("S4a switches the quick capture on and records its shortcut", async () => {
    await dismissDialogs();
    await $(`button[aria-label="${en.shortcuts.openSettings}"]`).click();
    const area = $(`//button[contains(@class,"pv-navlink")][.//span[normalize-space()="${en.settings.sectionBehavior}"]]`);
    await area.waitForExist({ timeout: 10_000 });
    await area.click();

    const card = $(`[role="group"][aria-label="${en.quickCapture.section}"]`);
    await card.waitForExist({ timeout: 10_000 });
    const toggle = card.$('[role="switch"]');
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("aria-checked")) === "true", {
      timeout: 10_000,
      timeoutMsg: "the quick capture switch did not turn on",
    });

    const record = '[data-testid="quick-capture-record"]';
    if (isMac) {
      // A real click: the recorder has to start without the focus the driver's
      // click would force onto the button.
      const at = await screenCentre(record);
      mac.clickAt(at.x, at.y);
    } else {
      await $(record).click();
    }
    await browser.waitUntil(async () => (await card.getText()).includes(en.quickCapture.recording), {
      timeout: 10_000,
      timeoutMsg: isMac
        ? "a real click on the recorder did not start the recording (issue #123)"
        : "a click on the recorder did not start the recording",
    });

    if (isMac) {
      mac.keystroke("k", ["control", "option"]);
    } else {
      // To the button, which the click left focused; the recorder listens on
      // the window and hears it there.
      await $(record).addValue(`${CTRL}${ALT}k`);
    }

    const shown = card.$('[data-testid="quick-capture-shortcut"]');
    await waitFor(
      async () => (await shown.getAttribute("aria-label")) === recordedLabel,
      10_000,
      async () => `the recorder did not take Control+Alt+K (shows "${await shown.getAttribute("aria-label")}")`,
    );
    // Registered, not just written down: the system refusing it would stand
    // under the switch.
    await browser.waitUntil(async () => (await toggle.getAttribute("disabled")) === null, { timeout: 10_000 });
    const text = await card.getText();
    if (text.includes(en.quickCapture.failedTaken) || text.includes(en.quickCapture.failedInvalid)) {
      throw new Error(`the system refused the recorded shortcut: ${text}`);
    }
  });

  (isMac ? it : it.skip)("S4b opens the capture window from the system-wide shortcut (macOS)", async () => {
    mac.activateFinder();
    await waitFor(
      () => mac.frontmostProcess() === "Finder",
      10_000,
      () => `the Finder did not come to the front (in front: ${mac.frontmostProcess()})`,
    );
    mac.keystroke("k", ["control", "option"]);
    await waitFor(
      async () => (await browser.getWindowHandles()).includes(CAPTURE_WINDOW),
      15_000,
      async () => `Control+Option+K with the Finder in front opened no capture window (windows: ${(await browser.getWindowHandles()).join(", ")})`,
    );
    await browser.switchToWindow(CAPTURE_WINDOW);
    await $('[data-testid="quick-capture"]').waitForExist({ timeout: 10_000 });
    await $('[data-testid="quick-capture-close"]').click();
    await browser.switchToWindow(mainHandle);
    mac.activatePlainva();
  });

  // Not on Windows, and not because of the app: the Windows smoke build gives
  // the main window a WebView2 debugging port in its browser arguments (the
  // Edge driver reaches the WebView no other way, tauri.smoke.conf.json), and
  // WebView2 refuses a second WebView with different arguments in the same
  // data folder. A window opened at run time has the default ones, so in this
  // build the second window is never created (2026-10-29: the app's own window
  // list held "main" alone). Linux and macOS run it.
  (process.platform === "win32" ? it.skip : it)("S5 moves the note into a second window that writes to the file", async () => {
    await browser.switchToWindow(mainHandle);
    await closeDialog();
    const before = await browser.getWindowHandles();

    // The command as the editor's menu has it.
    await $('[data-testid="editor-menu-btn"]').click();
    const item = $('[data-testid="editor-menu-new-window"]');
    await item.waitForExist({ timeout: 10_000 });
    await item.click();

    let second = "";
    await waitFor(
      async () => {
        const now = await browser.getWindowHandles();
        second = now.find((handle) => !before.includes(handle) && handle !== CAPTURE_WINDOW) ?? "";
        return second !== "";
      },
      20_000,
      async () =>
        `no second window appeared to the driver (before: ${before.join(", ")}; now: ${(await browser.getWindowHandles()).join(", ")}; ` +
        `the app's own windows: ${await appWindows()})`,
    );
    await browser.switchToWindow(second);
    const editor = $(".cm-content");
    await editor.waitForExist({ timeout: 20_000 });
    await browser.waitUntil(async () => (await editor.getText()).includes(marker), {
      timeout: 10_000,
      timeoutMsg: "the second window does not show the note's text",
    });
    await typeIntoEditor(` ${secondMarker}`);
    await waitFor(
      () => fileHolds(note(), secondMarker),
      20_000,
      () => `the second window's text never reached ${note()}; the file holds: ${existsSync(note()) ? JSON.stringify(readFileSync(note(), "utf8")) : "nothing"}`,
    );
    if (!fileHolds(note(), marker)) throw new Error("the second window's save lost the first marker");
    await browser.switchToWindow(mainHandle);
  });
});
