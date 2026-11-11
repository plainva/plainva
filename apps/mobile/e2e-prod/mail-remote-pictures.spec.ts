import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { readVaultFile, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A picture from the web in a message's text, filed on the phone (open-items
 * plan 3.79, decision E1). The phone's editor loads a picture a note embeds
 * from the web (`parse-budget.spec.ts`): filed unchanged, a tracking picture
 * in the sender's text would be fetched each time the note opens. The filed
 * note holds it as a link, and opening the note fetches nothing. The desktop
 * holds the same in `apps/desktop/e2e/mail.spec.ts`.
 *
 * No request leaves localhost: a request to the web is recorded and refused.
 */

const MESSAGE = {
  id: "fixture-remote-pictures",
  subject: "Newsletter Bilder",
  conversationId: "remote-pictures",
  bodyPreview: "Hallo Marco,",
  // Noon, so the day in the note's name is the same in every time zone a test runs in.
  receivedDateTime: "2026-09-13T12:00:00Z",
  body: {
    contentType: "text",
    content: "Hallo Marco,\n\n![](https://pixel.example.org/open.png?id=42)\n\nUnser Logo: ![Logo](https://pixel.example.org/logo.png)\n\n![[https://pixel.example.org/wiki.png]]\n\nGruß\n",
  },
};

async function bootMail(context: BrowserContext, page: Page, fetched: string[]) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => {
    const url = new URL(route.request().url());
    if (url.host === "pixel.example.org") fetched.push(url.pathname);
    return route.abort("blockedbyclient");
  });
  const mail = await installMailFixture(context, { extra: { archive: [MESSAGE] } });
  const sql = await installSqlBridge(context);
  const storage = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  await context.addInitScript((seed) => {
    if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
  }, storage);
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-mail").click();
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

async function filedNotes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const listing = await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "vault/Mail", directory: "DATA" });
      return listing.files.map((file) => file.name).filter((name) => name.endsWith(".md"));
    } catch {
      return [];
    }
  });
}

test("a filed mail with pictures from the web: the note holds links, and opening it fetches nothing", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const fetched: string[] = [];
  const { sql } = await bootMail(context, page, fetched);
  try {
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "Archiv" }).click();
    await page.locator("button.m-mailrow", { hasText: "Newsletter Bilder" }).click();
    // A text message is shown as text, its addresses as links.
    await expect(page.getByRole("link", { name: "https://pixel.example.org/logo.png" })).toBeVisible();
    await page.getByRole("button", { name: /^Save as note$/ }).click();
    await expect.poll(() => filedNotes(page), { timeout: 15_000 }).toHaveLength(1);
    const [name] = await filedNotes(page);
    const note = await readVaultFile(page, `Mail/${name}`);
    expect(note).toContain("# Newsletter Bilder\n\nHallo Marco,\n\n[https://pixel.example.org/open.png?id=42](https://pixel.example.org/open.png?id=42)\n\nUnser Logo: [Logo](https://pixel.example.org/logo.png)\n\n[https://pixel.example.org/wiki.png](https://pixel.example.org/wiki.png)\n\nGruß\n");
    // The note opens: its text and links are there, nothing was fetched.
    const editor = page.locator(".cm-content").first();
    await expect(editor.getByText("Gruß")).toBeVisible({ timeout: 15_000 });
    await expect(editor.getByText("Logo", { exact: true })).toBeVisible();
    // No picture: CodeMirror's own spacer images around a widget are no pictures of the note.
    await expect(editor.locator("img:not(.cm-widgetBuffer)")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-filed-links-phone.png") });
    await page.waitForTimeout(1500);
    expect(fetched).toEqual([]);
  } finally {
    await sql.close();
  }
});
