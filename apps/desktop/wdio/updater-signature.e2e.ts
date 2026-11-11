import { browser, $ } from "@wdio/globals";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The updater signature test (stability plan R11, finding S12 — open since
 * v0.1.0). Does the BUILT app refuse an update that is not what the Plainva
 * project signed? Run through `wdio.updater.conf.ts`, which serves one
 * manifest per case on a local address the test build asks; the test key
 * pair and the files come from `scripts/updater-signature-fixtures.mjs`.
 *
 *  U1  the start-up prompt: the app's own silent check finds 9.9.9 (a file
 *      with one byte changed), the toast offers it, its action downloads the
 *      file — and the app refuses it with Plainva's sentence, keeps running,
 *      and its binary is untouched
 *  U2  POSITIVE CONTROL: the genuine file with the genuine signature of the
 *      test key is accepted — downloaded and verified, up to the step before
 *      installing. Without it, a refusal below proves nothing: it could be a
 *      refusal for any reason.
 *  U3  one byte changed                     → refused (the signature fails)
 *  U4  signed with a foreign key            → refused (another key)
 *  U5  the signature of another file        → refused (the signature fails)
 *  U6  an older version offered (0.0.1), and the running one → nothing offered
 *  U7  an older release dressed up as new: the manifest says 9.9.9, the file
 *      was signed for 9.9.8                 → refused (version mismatch)
 *  U8  a signature that names no version    → refused (`requireSignedVersion`)
 *  U9  the settings' Updates: check, install, and the same refusal sentence
 *      for each refused case; the install button is gone afterwards
 *
 * U2–U8 call the updater plugin's own commands (`plugin:updater|check`,
 * `plugin:updater|download`) — the very commands the app's
 * `update.downloadAndInstall()` runs through: `download_and_install` is
 * `download` (where the signature is verified) followed by `install`. U2
 * stops before `install`: on this debug binary an install would write the
 * downloaded bytes over the running program. U1 and U9 go the whole way
 * through the app's own code, which a refusal ends before `install`.
 *
 * Each case prints one line `[updater-signature] <case>: …`, the evidence the
 * release checklist cites.
 */

const en = JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/ui/src/locales/en.json"), "utf8")) as {
  shortcuts: { openSettings: string };
  settings: {
    about: string;
    checkUpdates: string;
    installUpdate: string;
    noUpdate: string;
    updateAvailable: string;
    updateRefused: string;
  };
};

const port = Number(process.env.PLAINVA_UPDATER_TEST_PORT);
const control = `http://127.0.0.1:${port}`;
const appBinary = process.env.PLAINVA_UPDATER_APP ?? "";
const fixture = JSON.parse(readFileSync(resolve(process.env.PLAINVA_UPDATER_TEST_DIR ?? "", "fixture.json"), "utf8")) as { next: string; current: string };

const available = (version: string) => en.settings.updateAvailable.replace("{{version}}", version);
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
/** The cases that held, by their id ("U3"): the summary line is written only when every one did. */
const held = new Set<string>();
const report = (name: string, line: string) => {
  held.add(name.split(" ")[0]);
  console.log(`[updater-signature] ${name}: ${line}`);
};
/** What the person saw, kept beside the driver logs (the workflow uploads the folder). */
async function evidence(name: string): Promise<void> {
  mkdirSync("wdio-logs-updater", { recursive: true });
  await browser.saveScreenshot(join("wdio-logs-updater", `evidence-${process.platform}-${name}.png`));
}

async function useCase(name: string): Promise<void> {
  const res = await fetch(`${control}/__case/${encodeURIComponent(name)}`, { method: "POST" });
  if (res.status !== 204) throw new Error(`the test server has no case ${name}: ${res.status}`);
}

async function served(): Promise<string[]> {
  const res = await fetch(`${control}/__requests`);
  return ((await res.json()) as { requests: string[] }).requests;
}

interface PluginOutcome {
  check: "available" | "none" | "error";
  version?: string;
  download?: "accepted" | "refused";
  error?: string;
}

/**
 * The script the window runs: the plugin's `check`, then `download`, each
 * outcome written to the attribute `data-updater-test-outcome` of the page;
 * resources are closed.
 */
const UPDATER_PROBE = `
  document.documentElement.removeAttribute("data-updater-test-outcome");
  var ipc = window.__TAURI_INTERNALS__;
  var meta = null;
  ipc.invoke("plugin:updater|check", {})
    .then(function (m) {
      meta = m;
      if (!m) return { check: "none" };
      // A channel the way @tauri-apps/api serialises one.
      var channel = "__CHANNEL__:" + ipc.transformCallback(function () {});
      return ipc.invoke("plugin:updater|download", { rid: m.rid, onEvent: channel }).then(
        function (bytes) {
          ipc.invoke("plugin:resources|close", { rid: bytes }).catch(function () {});
          return { check: "available", version: m.version, download: "accepted" };
        },
        function (error) {
          return { check: "available", version: m.version, download: "refused", error: String(error) };
        }
      );
    })
    .then(
      function (outcome) {
        if (meta) ipc.invoke("plugin:resources|close", { rid: meta.rid }).catch(function () {});
        document.documentElement.setAttribute("data-updater-test-outcome", JSON.stringify(outcome));
      },
      function (error) {
        document.documentElement.setAttribute("data-updater-test-outcome", JSON.stringify({ check: "error", error: String(error) }));
      }
    );
`;

/** The updater plugin's own check and download, in the app's window. */
async function pluginCheckAndDownload(): Promise<PluginOutcome> {
  // Started in the window and read back from the page's attribute, never
  // through a script: the driver service reports a rejected IPC call of the
  // page as the error of the NEXT script it runs ("execute/async" failed
  // with the plugin's refusal although the probe caught it — CI runs 1 and 3,
  // 2026-11-11), which lost the outcome the case is about. An element's
  // attribute is read without a script.
  // As a string: the spec is transpiled with names kept, and a function
  // handed to the window then calls a helper (`__name`) that exists only in
  // this process (second CI run, 2026-11-11).
  await browser.execute(UPDATER_PROBE);
  let outcome: PluginOutcome | undefined;
  await browser.waitUntil(
    async () => {
      const json = await $("html").getAttribute("data-updater-test-outcome");
      outcome = json ? (JSON.parse(json) as PluginOutcome) : undefined;
      return outcome !== undefined;
    },
    { timeout: 30_000, interval: 200, timeoutMsg: "the updater plugin never answered" },
  );
  return outcome!;
}

async function dismissDialogs(): Promise<void> {
  for (let round = 0; round < 3 && (await $('[role="dialog"]').isExisting()); round += 1) {
    await browser.keys("Escape");
    await browser.pause(400);
  }
}

/** The status line of the settings' Updates group. */
async function updateStatus(): Promise<string> {
  const desc = $(
    `//*[@data-testid="about-updates"]//div[contains(concat(" ",@class," ")," pv-setrow ")][.//button[normalize-space()="${en.settings.checkUpdates}"]]//div[contains(@class,"pv-setrow-desc")]`,
  );
  return (await desc.isExisting()) ? (await desc.getText()).trim() : "";
}

/** Waits for the status line; a failure names the line as it stood at the timeout. */
async function waitForStatus(expected: string, what: string, timeout: number): Promise<void> {
  try {
    await browser.waitUntil(async () => (await updateStatus()) === expected, { timeout, interval: 300 });
  } catch (error) {
    throw new Error(`${what} (status: "${await updateStatus()}")`, { cause: error });
  }
}

async function updatesButton(label: string) {
  return $(`//*[@data-testid="about-updates"]//button[normalize-space()="${label}"]`);
}

describe("Updater signature test", () => {
  let binaryBefore = "";

  before(async () => {
    if (!port || !appBinary) throw new Error("wdio.updater.conf.ts did not prepare the run");
    binaryBefore = sha256(appBinary);
    // The explicit switch first: without it the service looks for the active
    // window before every find, five seconds each time (smoke.e2e.ts, S1) —
    // the first CI run spent the start-up prompt's twelve seconds on that.
    await browser.switchToWindow(await browser.getWindowHandle());
  });

  it("U1 refuses a changed file offered by the start-up prompt", async () => {
    // The first case is set before the app started (wdio.updater.conf.ts):
    // the start-up check runs about ten seconds after the start.
    const offer = $(`//div[contains(@class,"pv-toast")][.//div[contains(@class,"pv-toast-msg")][normalize-space()="${available(fixture.next)}"]]`);
    try {
      await offer.waitForExist({ timeout: 60_000, interval: 250 });
    } catch (error) {
      const toasts = await browser.execute(() => [...document.querySelectorAll(".pv-toast-msg")].map((el) => el.textContent ?? ""));
      throw new Error(`the start-up check never offered the update; the server saw ${JSON.stringify(await served())}, toasts now: ${JSON.stringify(toasts)}`, { cause: error });
    }
    const action = offer.$(".pv-toast-action");
    try {
      await action.click();
    } catch {
      // A first-start dialog over the toasts takes a driver click; the toast's own button is what counts.
      await browser.execute((el: HTMLElement) => el.click(), action as unknown as HTMLElement);
    }
    const refusal = $(`//div[contains(@class,"pv-toast--error")][.//div[contains(@class,"pv-toast-msg")][normalize-space()="${en.settings.updateRefused}"]]`);
    await refusal.waitForExist({ timeout: 30_000, timeoutMsg: "no refusal toast with Plainva's sentence after Install" });
    await evidence("u1-startup-refused");
    const fetched = await served();
    if (!fetched.includes("/files/Plainva_update-tampered.bin")) throw new Error(`the app never downloaded the changed file: ${fetched.join(", ")}`);
    await $('[data-testid="ribbon-tasks"]').waitForExist({ timeout: 60_000, timeoutMsg: "the app is gone after the refusal" });
    if (sha256(appBinary) !== binaryBefore) throw new Error("the program file changed — something was installed");
    report("U1 start-up prompt, one byte changed", "REFUSED (toast: updateRefused), app running, binary unchanged");
    await dismissDialogs();
  });

  it("U2 accepts the genuine file with the genuine signature (positive control)", async () => {
    await $('[data-testid="ribbon-tasks"]').waitForExist({ timeout: 60_000 });
    await useCase("a-valid");
    const outcome = await pluginCheckAndDownload();
    if (outcome.check !== "available" || outcome.version !== fixture.next) throw new Error(`no offer of ${fixture.next}: ${JSON.stringify(outcome)}`);
    if (outcome.download !== "accepted") throw new Error(`the genuine file was refused — every refusal below would prove nothing: ${outcome.error}`);
    if (!(await served()).includes("/files/Plainva_update.bin")) throw new Error("accepted without downloading the file");
    report("U2 positive control", `ACCEPTED (offered ${outcome.version}, downloaded and verified; install not run)`);
  });

  const refusals: Array<{ id: string; name: string; caseName: string; words: string }> = [
    { id: "U3", name: "one byte changed", caseName: "b-tampered", words: "The signature verification failed" },
    { id: "U4", name: "signed with a foreign key", caseName: "c-foreign-key", words: "The signature was created with a different key than the one provided" },
    { id: "U5", name: "the signature of another file", caseName: "d-other-file-signature", words: "The signature verification failed" },
    { id: "U7", name: "an older release announced as new", caseName: "f-older-release-as-new", words: "was signed for version 9.9.8 but the update endpoint announced version 9.9.9" },
    { id: "U8", name: "a signature without a version", caseName: "g-unversioned-signature", words: "does not specify the version it was signed for" },
  ];

  for (const r of refusals) {
    it(`${r.id} refuses ${r.name}`, async () => {
      await useCase(r.caseName);
      const outcome = await pluginCheckAndDownload();
      if (outcome.check !== "available") throw new Error(`the check did not offer the update: ${JSON.stringify(outcome)}`);
      if (outcome.download !== "refused") throw new Error(`ACCEPTED ${r.name} — the updater does not refuse it`);
      // Refused for THIS reason, not for any: the plugin's own words.
      if (!outcome.error?.includes(r.words)) throw new Error(`refused, but not for the expected reason: ${outcome.error}`);
      const fetched = await served();
      if (!fetched.some((path) => path.startsWith("/files/"))) throw new Error(`refused without downloading anything: ${fetched.join(", ")}`);
      report(`${r.id} ${r.name}`, `REFUSED (${outcome.error})`);
    });
  }

  it("U6 offers neither an older version nor the running one", async () => {
    for (const caseName of ["e-downgrade", "e-same-version"]) {
      await useCase(caseName);
      const outcome = await pluginCheckAndDownload();
      if (outcome.check !== "none") throw new Error(`${caseName}: the check offered ${JSON.stringify(outcome)}`);
      if ((await served()).some((path) => path.startsWith("/files/"))) throw new Error(`${caseName}: a file was downloaded`);
      report(`U6 ${caseName}`, "NOT OFFERED (check returned no update; nothing downloaded)");
    }
  });

  it("U9 the settings show Plainva's refusal and drop the offer", async () => {
    await dismissDialogs();
    await $(`button[aria-label="${en.shortcuts.openSettings}"]`).click();
    const area = $(`//button[contains(@class,"pv-navlink")][.//span[normalize-space()="${en.settings.about}"]]`);
    await area.waitForExist({ timeout: 10_000 });
    await area.click();
    await $('[data-testid="about-updates"]').waitForExist({ timeout: 10_000 });

    for (const r of refusals) {
      await useCase(r.caseName);
      await (await updatesButton(en.settings.checkUpdates)).click();
      await waitForStatus(available(fixture.next), `${r.id}: the settings never offered ${fixture.next}`, 20_000);
      await (await updatesButton(en.settings.installUpdate)).click();
      await waitForStatus(en.settings.updateRefused, `${r.id}: no refusal in the settings`, 30_000);
      const fetchedHere = await served();
      if (!fetchedHere.some((path) => path.startsWith("/files/"))) throw new Error(`${r.id}: the settings refused without downloading anything: ${fetchedHere.join(", ")}`);
      if (await (await updatesButton(en.settings.installUpdate)).isExisting()) throw new Error(`${r.id}: the refused update is still offered`);
      if (r.id === "U3") await evidence("u9-settings-refused");
      report(`U9 settings, ${r.name}`, "REFUSED after the download (status line: updateRefused, install button gone)");
    }

    await useCase("e-downgrade");
    await (await updatesButton(en.settings.checkUpdates)).click();
    await waitForStatus(en.settings.noUpdate, "the older version was offered in the settings", 20_000);
    report("U9 settings, older version", "NOT OFFERED (status line: noUpdate)");

    if (sha256(appBinary) !== binaryBefore) throw new Error("the program file changed — something was installed");
    const missing = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9"].filter((id) => !held.has(id));
    if (missing.length) throw new Error(`no summary: ${missing.join(", ")} did not hold`);
    report("summary", "every refused case refused, the positive control accepted, the program file unchanged");
  });
});
