import { test, expect } from "./clockedTest";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A file embed is a card on the phone too (plan Rückmeldungen 05.11., P4;
 * decision E2). `![[Mietvertrag.pdf#height=600]]` was read as text and said
 * "could not be read" about a PDF that was there (TestFlight, build 163). Now
 * the note shows a card with the file's name, size and folder; "Open" hands
 * the file to the system — in the web shell that is a download. A file that is
 * not there says so.
 */
const PDF = [..."%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"].map((char) => char.charCodeAt(0) & 0xff);
const NOTE = "# Wohnung\n\nUnterlagen zum Mietvertrag:\n\n![[Mietvertrag.pdf#height=600]]\n\nNicht da:\n\n![[Fehlt.pdf]]\n";

test("a PDF embedded in a note is a card with name, size and Open, and a missing file says it was not found", async ({ page }) => {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async ({ note, pdf }) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    await fs.writeFile({ path: "vault/Wohnung.md", data: note, directory: "DATA" as never, encoding: "utf8" as never, recursive: true });
    // The PDF lies there as bytes, the way a sync leaves it.
    await fs.writeFile({ path: "vault/Anhänge/Mietvertrag.pdf", data: new Blob([new Uint8Array(pdf)]), directory: "DATA" as never, recursive: true });
  }, { note: NOTE, pdf: PDF });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Wohnung / }).first().click();

  const card = page.getByTestId("file-embed");
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  await expect(card).toHaveAttribute("data-path", "Anhänge/Mietvertrag.pdf");
  await expect(card.locator(".pv-filecard-name")).toHaveText("Mietvertrag.pdf");
  await expect(card.locator(".pv-filecard-meta")).toHaveText(`${PDF.length} B · Anhänge/`);
  await expect(page.getByText(/could not be read/)).toHaveCount(0);
  await expect(page.locator(".m-embed-card.is-missing")).toContainText("“Fehlt.pdf” was not found.");
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("file-embed-mobile.png") });

  // "Open" hands the file over (the web shell downloads it) and stays on the note.
  const download = page.waitForEvent("download");
  await card.getByTestId("file-embed-open").click();
  expect((await download).suggestedFilename()).toBe("Mietvertrag.pdf");
  await expect(card).toBeVisible();
});
