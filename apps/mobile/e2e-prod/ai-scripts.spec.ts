import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The gate of the scripts on the phone (AI harness P5.5): no script runs
 * without this phone's signature under its approval, and a script that does
 * not stop is ended. The engine is the real one — the script worker of the
 * production bundle, QuickJS as WebAssembly —, the files are written through
 * the platform's file system behind the app's back, the way a sync writes
 * them, and the surface is the skills segment of the AI screen.
 */

const DIR = "vault/.agent/scripts";
const COUNT = {
  manifest: JSON.stringify({ name: "word-count", title: "Count words", description: "Counts the words of a note.", tools: ["read_note"], input: [{ name: "path", type: "text", description: "The note, as a path in the vault", required: true }] }, null, 2),
  main: 'const note = await tools.read_note({ path: input.path });\nconst words = note.text.split(/\\s+/).filter(Boolean).length;\nconsole.log("read " + note.path);\nreturn { path: note.path, words };\n',
};
const SPIN = {
  manifest: JSON.stringify({ name: "regex-spin", description: "Never comes back from a regular expression.", tools: [], limits: { seconds: 1 } }, null, 2),
  main: 'return /^(a+)+$/.test("a".repeat(40) + "!");\n',
};

/** Written as bytes, the way a sync writes a file: the scan reads bytes (it hashes them). */
async function writeFile(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ path, text }) => {
      let binary = "";
      for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path, data: btoa(binary), directory: "DATA", recursive: true });
    },
    { path, text },
  );
}

/** A file of the vault as the app wrote it; null when there is none. */
async function readVaultFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (path) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const file = await fs.readFile({ path, directory: "DATA" }).catch(() => null);
    if (!file || typeof file.data !== "string") return null;
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)));
    } catch {
      return file.data;
    }
  }, path);
}

/** The approvals of this device: in the app's data under `ai/`, never in the vault. */
async function approvals(page: Page): Promise<{ path: string; text: string }[]> {
  return page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const out: { path: string; text: string }[] = [];
    const vaults = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    for (const entry of vaults.files) {
      const path = `ai/${entry.name}/instructions.json`;
      const file = await fs.readFile({ path, directory: "DATA", encoding: "utf8" }).catch(() => null);
      if (file && typeof file.data === "string") out.push({ path, text: file.data });
    }
    return out;
  });
}

test("a script runs for nobody until this phone signed it, then in its box — and is ended when it does not stop", async ({ page, context }) => {
  test.setTimeout(180_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The AI is opt-in per device: switched on here as the settings would store it.
    localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true }));
  });
  const shot = async (name: string) => {
    if (!process.env.PLAINVA_EVIDENCE) return;
    // A sheet slides in: the picture is of the finished surface.
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  };
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await writeFile(page, `${DIR}/word-count/manifest.json`, COUNT.manifest);
    await writeFile(page, `${DIR}/word-count/main.js`, COUNT.main);
    await writeFile(page, `${DIR}/regex-spin/manifest.json`, SPIN.manifest);
    await writeFile(page, `${DIR}/regex-spin/main.js`, SPIN.main);
    // A note is read as text; the browser's file system keeps a file written as text apart from one written as bytes.
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Report.md", data: "# Report\n\nOne two three four five.\n", directory: "DATA", encoding: "utf8" });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15_000 });
    await close.click();

    // The skills segment of the AI screen.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-skills").click();
    const workshop = page.getByTestId("ai-skills-workshop");
    await expect(workshop).toBeVisible();
    const waiting = workshop.getByTestId("ai-skill-review");
    const row = (title: string) => workshop.getByTestId("ai-skill-row").filter({ hasText: title });
    const reopen = async () => {
      // The workshop reads the vault's sources when it opens.
      await page.getByTestId("ai-history-chats").click();
      await page.getByTestId("ai-history-skills").click();
    };

    // 1. Arrived, never approved here: both wait, and neither stands among what can be run.
    await expect(waiting).toHaveCount(2);
    await expect(row("Count words")).toHaveCount(0);
    await expect(workshop).toContainText("No scripts yet.");
    await shot("scripts-1-waiting-phone");

    // 2. The review: what the manifest asks for in words, the whole code, and that the engine reads it.
    await waiting.filter({ hasText: "Count words" }).click();
    const approval = page.getByTestId("ai-skill-approval");
    await expect(approval).toContainText("It calls these tools: Reading a note.");
    await expect(approval.getByTestId("ai-script-limits")).toContainText("5 s of computing");
    await expect(approval.getByTestId("ai-script-code")).toContainText("await tools.read_note({ path: input.path })");
    await expect(approval.getByTestId("ai-script-check")).toHaveAttribute("data-mark", "pass");
    await shot("scripts-2-approval-phone");
    await approval.getByTestId("ai-skill-approve").click();
    await expect(approval).toHaveCount(0);

    // Approved: signed by this phone, and one of the vault's scripts now.
    await expect(waiting).toHaveCount(1);
    await expect(row("Count words")).toHaveCount(1);
    const approved = await approvals(page);
    expect(approved).toHaveLength(1);
    const record = JSON.parse(approved[0]!.text).approved.find((entry: { id: string }) => entry.id === ".agent/scripts/word-count");
    expect(record.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);

    // 3. An approval is only worth this phone's signature: with another one under it, the script waits again.
    const forged = approved[0]!.text.replace(record.signature, `${record.signature.slice(0, 20)}${record.signature[20] === "A" ? "B" : "A"}${record.signature.slice(21)}`);
    await page.evaluate(
      async ({ path, text }) => {
        await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path, data: text, directory: "DATA", encoding: "utf8" });
      },
      { path: approved[0]!.path, text: forged },
    );
    await reopen();
    await expect(waiting).toHaveCount(2);
    await expect(row("Count words")).toHaveCount(0);
    await waiting.filter({ hasText: "Count words" }).click();
    await expect(approval).toContainText("this device did not sign it");
    await approval.getByTestId("ai-skill-approve").click();
    await expect(approval).toHaveCount(0);
    await expect(row("Count words")).toHaveCount(1);

    // 4. A run from the row's sheet: the input it asks for, its call, its value, what it used.
    await row("Count words").click();
    await page.getByTestId("ai-skill-action-run").click();
    const run = page.getByTestId("ai-script-run");
    await expect(run.getByTestId("ai-script-start")).toBeDisabled();
    await run.getByTestId("ai-script-field-path").fill("Report.md");
    await shot("scripts-3-run-phone");
    await run.getByTestId("ai-script-start").click();
    await expect(run.getByTestId("ai-script-outcome")).toContainText("Finished.", { timeout: 30_000 });
    await expect(run.getByTestId("ai-script-call")).toHaveCount(1);
    await expect(run.getByTestId("ai-script-call")).toContainText("Reading a note");
    await expect(run.getByTestId("ai-script-result")).toContainText('"words": 7');
    await expect(run.getByTestId("ai-script-log")).toContainText("read Report.md");
    await expect(run.getByTestId("ai-script-usage")).toContainText("1 of 20 calls");
    await run.getByTestId("ai-script-usage").scrollIntoViewIfNeeded();
    await shot("scripts-4-result-phone");
    await run.getByRole("button", { name: "Close", exact: true }).click();
    await expect(run).toHaveCount(0);

    // 5. A script that does not come back: no step of a regular expression is counted, so its worker is ended.
    await waiting.click();
    await expect(approval.getByTestId("ai-script-limits")).toContainText("1 s of computing");
    await approval.getByTestId("ai-skill-approve").click();
    await expect(approval).toHaveCount(0);
    await row("regex-spin").click();
    await page.getByTestId("ai-skill-action-run").click();
    await run.getByTestId("ai-script-start").click();
    await expect(run.getByTestId("ai-script-outcome")).toContainText("it computed longer than its 1 seconds", { timeout: 20_000 });
    await expect(run.getByTestId("ai-script-result")).toHaveCount(0);
    await shot("scripts-5-ended-phone");
    await run.getByRole("button", { name: "Close", exact: true }).click();
    // Ended is ended: the next run gets an engine of its own and works.
    await row("Count words").click();
    await page.getByTestId("ai-skill-action-run").click();
    await run.getByTestId("ai-script-field-path").fill("Report.md");
    await run.getByTestId("ai-script-start").click();
    await expect(run.getByTestId("ai-script-outcome")).toContainText("Finished.", { timeout: 30_000 });
    await run.getByRole("button", { name: "Close", exact: true }).click();

    // 6. A script written here: code the engine does not read is not written; what is written is approved as it is.
    await workshop.getByTestId("ai-scripts-new").click();
    const form = page.getByTestId("ai-script-form");
    await form.getByTestId("ai-script-name").fill("query-length");
    await form.getByTestId("ai-script-description").fill("Says how long the query is.");
    await form.getByTestId("ai-script-tool-search_vault").uncheck();
    await form.getByTestId("ai-script-code-field").fill("return { length: input.query.length ");
    await form.getByTestId("ai-script-save").click();
    await expect(form.getByTestId("ai-script-form-error")).toContainText("The engine does not read this code");
    expect(await readVaultFile(page, `${DIR}/query-length/main.js`)).toBeNull();
    await form.getByTestId("ai-script-code-field").fill("return { length: input.query.length };\n");
    await shot("scripts-6b-form-code-phone");
    await form.getByTestId("ai-script-name").scrollIntoViewIfNeeded();
    await shot("scripts-6-form-phone");
    await form.getByTestId("ai-script-save").click();
    await expect(form).toHaveCount(0);
    await expect(row("query-length")).toHaveCount(1);
    expect(JSON.parse((await readVaultFile(page, `${DIR}/query-length/manifest.json`)) ?? "null")).toEqual({ name: "query-length", description: "Says how long the query is.", tools: [], input: [{ name: "query", type: "text", required: true }] });
    expect(await readVaultFile(page, `${DIR}/query-length/main.js`)).toBe("return { length: input.query.length };\n");
    await row("query-length").click();
    await page.getByTestId("ai-skill-action-run").click();
    await run.getByTestId("ai-script-field-query").fill("hello");
    await run.getByTestId("ai-script-start").click();
    await expect(run.getByTestId("ai-script-result")).toContainText('"length": 5', { timeout: 30_000 });
    await run.getByRole("button", { name: "Close", exact: true }).click();

    // 7. Revoked, it waits again; nothing of it can be run until it is reviewed.
    await row("query-length").click();
    await expect(page.getByTestId("ai-skill-action-showInstructions")).toContainText("Show code");
    await page.getByTestId("ai-skill-action-revoke").click();
    await expect(row("query-length")).toHaveCount(0);
    await expect(waiting).toHaveCount(1);

    // 8. The second stage: a script that suggests. Written with a writing tool ticked; what it lays down is a
    //    suggestion on the note — the note itself is as it was.
    const REPORT = "# Report\n\nOne two three four five.\n";
    await workshop.getByTestId("ai-scripts-new").click();
    await form.getByTestId("ai-script-name").fill("add-line");
    await form.getByTestId("ai-script-description").fill("Suggests a line at the end of a note.");
    await form.getByTestId("ai-script-tool-search_vault").uncheck();
    await form.getByTestId("ai-script-tool-propose_edit").check();
    await form.getByTestId("ai-script-code-field").fill('return await tools.propose_edit({ path: input.query, append: "Checked by a script.", note: "Adds a line." });\n');
    await form.getByTestId("ai-script-tool-propose_edit").scrollIntoViewIfNeeded();
    await shot("scripts-7-form-writing-phone");
    await form.getByTestId("ai-script-save").click();
    await expect(form).toHaveCount(0);
    await expect(row("add-line")).toHaveCount(1);
    // Its review says what a writing tool means.
    await row("add-line").click();
    await page.getByTestId("ai-skill-action-showInstructions").click();
    await expect(approval).toContainText("It can suggest changes and leave drafts, signed with its name.");
    await approval.getByRole("button", { name: "Close", exact: true }).click();
    await expect(approval).toHaveCount(0);

    await row("add-line").click();
    await page.getByTestId("ai-skill-action-run").click();
    await run.getByTestId("ai-script-field-query").fill("Report.md");
    // A dry run lays nothing down: the writing call is written down, not carried out.
    await run.getByTestId("ai-script-dry").click();
    await expect(run.getByTestId("ai-script-outcome")).toContainText("Dry run finished.", { timeout: 30_000 });
    await expect(run.getByTestId("ai-script-call")).toContainText("not carried out");
    await expect(run.getByTestId("ai-script-laid")).toHaveCount(0);
    // The run itself: one suggestion, on the note it was told.
    await run.getByTestId("ai-script-start").click();
    const laid = run.getByTestId("ai-script-laid");
    await expect(laid.getByTestId("ai-proposed")).toContainText("Report", { timeout: 30_000 });
    await laid.scrollIntoViewIfNeeded();
    await shot("scripts-8-laid-phone");
    expect(await readVaultFile(page, "vault/Report.md")).toBe(REPORT);
    // The line opens the note and closes the sheet.
    await laid.getByTestId("ai-proposed").click();
    await expect(run).toHaveCount(0);
    expect(await readVaultFile(page, "vault/Report.md")).toBe(REPORT);
  } finally {
    await sql.close();
  }
});
