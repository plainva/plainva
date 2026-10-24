import { expect, test, type Locator, type Page } from "@playwright/test";
import { openProbePage } from "./fixtures/openProbePage";
import type { FloatingLayerProbeWindow, ProbeTheme } from "./fixtures/floatingLayerProbe";

// Where a floating window lies (docs/engineering/Design_Language.md, "Z layers").
//
// A floating window — the note preview, the mail draft, the event preview — is
// not modal: it does not dim the app and stays open while everything else is
// used. So a dialog, a palette or a menu can open while it is there, and the
// window itself opens menus, popovers and dialogs of its own.
//
// Until 2026-10-09 the window shared its layer with the dialogs. With equal
// layers the order in the document decides, and the window is portalled to the
// end of the body: it lay over every dialog that opened beside it, over the
// dimmed ground as well, and stayed usable in front of the dialog. Escape went
// to the window first, whatever lay over it, and two windows kept the order
// they were opened in.

async function open(page: Page, theme?: ProbeTheme) {
  await page.route("**/__floating_layer_probe", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/floatingLayerProbe.tsx');</script></body></html>` }));
  page.on("pageerror", (error) => console.log("Floating layer probe:", error.message));
  await openProbePage(page, "/__floating_layer_probe", () => !!(window as FloatingLayerProbeWindow).floatingLayerProbe);
  await page.evaluate((t) => (window as FloatingLayerProbeWindow).floatingLayerProbe.mount(t), theme);
}

/** Whether a click at the centre of `target` would reach it — nothing else lies over that point. */
const reachable = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });

/**
 * Clicks the POINT at the centre of `target`: whatever lies there takes the
 * click. (A locator click would wait until the target itself is free, which
 * hides exactly the failure this file is about.)
 */
async function clickAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const win = (page: Page, id: "a" | "b") => page.getByTestId(`win-${id}`);

// The two themes that redraw every surface run the same rules: a theme that
// gave a panel a transform or a filter would move it into a layer of its own.
const THEMES: readonly (ProbeTheme | undefined)[] = [
  undefined,
  { name: "lcars", mode: "dark", variant: "make-it-so" },
  { name: "win95", mode: "light" },
];
for (const theme of THEMES) {
  const name = theme?.name ?? "default theme";
  const shot = theme?.name ?? "default";

  test(`${name}: a dialog lies in front of a floating window, and a click into it lands in it`, async ({ page }) => {
    await open(page, theme);
    await page.getByTestId("open-a").click();
    await expect(win(page, "a")).toBeVisible();
    await page.getByTestId("open-dialog").click();
    await expect(page.getByTestId("dialog")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath(`dialog-over-window-${shot}.png`) });

    // The dialog is small and centered, the window large and centered: every
    // point of the dialog is a point of the window.
    const field = page.getByTestId("dialog-field");
    expect(await reachable(field)).toBe(true);
    await clickAt(page, field);
    await page.keyboard.type("in the dialog");
    await expect(field).toHaveValue("in the dialog");

    // The window is part of what the dialog dims: it cannot be used past it.
    expect(await reachable(page.getByTestId("a-field"))).toBe(false);
    await clickAt(page, page.getByTestId("a-field"));
    await page.keyboard.type("x");
    await expect(page.getByTestId("a-field")).toHaveValue("");
  });

  test(`${name}: a menu, a popover, a select and a dialog a floating window opens stay in front of it`, async ({ page }) => {
    await open(page, theme);
    await page.getByTestId("open-a").click();

    await page.getByTestId("a-menu-btn").click();
    const menuItem = page.getByTestId("a-menu-two");
    await expect(menuItem).toBeVisible();
    expect(await reachable(menuItem)).toBe(true);
    await clickAt(page, menuItem);
    await expect(page.getByTestId("a-choice")).toHaveText("two");

    await page.getByTestId("a-popover-btn").click();
    const popRow = page.getByTestId("a-popover-three");
    await expect(popRow).toBeVisible();
    expect(await reachable(popRow)).toBe(true);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath(`popover-from-window-${shot}.png`) });
    await clickAt(page, popRow);
    await expect(page.getByTestId("a-choice")).toHaveText("three");

    await page.getByTestId("a-select").click();
    const option = page.getByRole("listbox").getByRole("option", { name: "Choice one" });
    await expect(option).toBeVisible();
    expect(await reachable(option)).toBe(true);
    await clickAt(page, option);
    await expect(page.getByTestId("a-choice")).toHaveText("one");

    await page.getByTestId("a-dialog-btn").click();
    const field = page.getByTestId("a-dialog-field");
    await expect(page.getByTestId("a-dialog")).toBeVisible();
    expect(await reachable(field)).toBe(true);
    await clickAt(page, field);
    await page.keyboard.type("in the window's dialog");
    await expect(field).toHaveValue("in the window's dialog");
  });
}

test("a palette lies in front of a floating window", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-palette").click();
  const field = page.getByTestId("palette-field");
  await expect(field).toBeVisible();
  expect(await reachable(field)).toBe(true);
  await clickAt(page, field);
  await page.keyboard.type("command");
  await expect(field).toHaveValue("command");
});

test("the floating window in use is in front of the others, and so is what it opens", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-b").click();
  // The one opened last is in front: b lies inside a, and its field can be reached.
  await expect(win(page, "b")).toBeVisible();
  expect(await reachable(page.getByTestId("b-field"))).toBe(true);

  // a's row of controls is above b's upper edge. Using a brings it forward —
  // and its menu, which hangs down over b, with it.
  await page.getByTestId("a-menu-btn").click();
  const menuItem = page.getByTestId("a-menu-three");
  await expect(menuItem).toBeVisible();
  const overB = await menuItem.evaluate((el) => {
    const m = el.getBoundingClientRect();
    const b = document.querySelector('[data-testid="win-b"]')!.getBoundingClientRect();
    const x = m.left + m.width / 2;
    const y = m.top + m.height / 2;
    return x > b.left && x < b.right && y > b.top && y < b.bottom;
  });
  expect(overB, "the probe's geometry: the menu item must lie over window b").toBe(true);
  expect(await reachable(menuItem)).toBe(true);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath("menu-of-the-window-in-use.png") });
  await clickAt(page, menuItem);
  await expect(page.getByTestId("a-choice")).toHaveText("three");
  expect(await reachable(page.getByTestId("b-field"))).toBe(false);

  // Closing the window in front gives the other one back.
  await page.keyboard.press("Escape");
  await expect(win(page, "a")).toHaveCount(0);
  await expect(win(page, "b")).toBeVisible();
  expect(await reachable(page.getByTestId("b-field"))).toBe(true);
});

test("a window comes forward when its host shows something else in it", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-b").click();
  expect(await reachable(page.getByTestId("b-field"))).toBe(true);

  // A row clicked in a database opens into the preview that is already open.
  // It must not do that behind another window.
  await page.getByTestId("next-in-a").click();
  await expect.poll(() => reachable(page.getByTestId("b-field"))).toBe(false);
  expect(await reachable(page.getByTestId("a-field"))).toBe(true);
});

for (const how of ["window", "detached"] as const) {
  test(`a floating window opened from a dialog lies in front of that dialog (${how === "window" ? "same tree" : "a root of its own, like an embedded database"})`, async ({ page }) => {
    await open(page);
    await page.getByTestId("open-dialog").click();
    await page.getByTestId(`dialog-open-${how}`).click();
    const field = page.getByTestId("b-field");
    await expect(win(page, "b")).toBeVisible();
    expect(await reachable(field)).toBe(true);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath(`window-from-dialog-${how}.png`) });
    await clickAt(page, field);
    await page.keyboard.type("in the window");
    await expect(field).toHaveValue("in the window");

    // What that window opens is in front of it, as anywhere else.
    await page.getByTestId("b-menu-btn").click();
    const menuItem = page.getByTestId("b-menu-two");
    await expect(menuItem).toBeVisible();
    expect(await reachable(menuItem)).toBe(true);

    // Escape closes the menu, then the window — the dialog behind it last.
    await page.keyboard.press("Escape");
    await expect(menuItem).toHaveCount(0);
    await expect(win(page, "b")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(win(page, "b")).toHaveCount(0);
    await expect(page.getByTestId("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dialog")).toHaveCount(0);
  });
}

test("Escape closes what is in front: the dialog before the window under it", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-dialog").click();
  await expect(page.getByTestId("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dialog")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(win(page, "a")).toHaveCount(0);
});

test("Escape closes what is in front: the palette before the window under it", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-palette").click();
  await expect(page.getByTestId("palette")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();
});

test("Escape closes what is in front: a window's own menu, select and dialog before the window", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();

  await page.getByTestId("a-menu-btn").click();
  await expect(page.getByTestId("a-menu-two")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("a-menu-two")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();

  await page.getByTestId("a-select").click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();

  await page.getByTestId("a-dialog-btn").click();
  await expect(page.getByTestId("a-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("a-dialog")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(win(page, "a")).toHaveCount(0);
});

// The two windows are hosted apart, as in the app (a database and the calendar
// each keep their own): closing one re-renders nothing of the other. Every
// window listens for Escape itself, so one key press reaches both listeners —
// and after the first has closed its window, the second finds its own in front.
test("Escape closes one floating window, the one in front — opened last", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-b").click();

  await page.keyboard.press("Escape");
  await expect(win(page, "b")).toHaveCount(0);
  await expect(win(page, "a")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(win(page, "a")).toHaveCount(0);
});

test("Escape closes one floating window, the one in front — opened first and used last", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-b").click();
  // a's head is clear of b; pressing it brings a forward.
  await win(page, "a").locator(".pv-peek-title").click();
  expect(await reachable(page.getByTestId("b-field"))).toBe(false);

  await page.keyboard.press("Escape");
  await expect(win(page, "a")).toHaveCount(0);
  await expect(win(page, "b")).toBeVisible();
});

test("a held Escape closes one floating window, not one with every repeat", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-a").click();
  await page.getByTestId("open-b").click();

  await page.keyboard.down("Escape");
  await expect(win(page, "b")).toHaveCount(0);
  // A second key-down without a key-up in between is what a held key sends.
  await page.keyboard.down("Escape");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  await expect(win(page, "a")).toBeVisible();
});
