// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The vault's name in the phone's Notes head opens vault switching, as the
 * desktop's vault switcher does. The bar renders the title as a button only
 * when the screen hands it a handler; the Notes route hands it the push of
 * the vaults screen, and a title without a handler stays a plain heading.
 */

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));

const { AppBar } = await import("./components/AppBar");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: Partial<Parameters<typeof AppBar>[0]>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<AppBar large title="Work vault" {...props} />);
  });
  return {
    host,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the vault name in the Notes head", () => {
  it("is a button that calls the handler, named for what it does", async () => {
    expect.hasAssertions();
    const onTitleClick = vi.fn();
    const { host, done } = await render({ onTitleClick, titleActionLabel: "Work vault — Switch Vault", titleTestId: "home-vault-switch" });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="home-vault-switch"]');
    expect(button?.closest("h1")).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Work vault — Switch Vault");
    expect(button?.textContent).toBe("Work vault");
    await act(async () => button?.click());
    expect(onTitleClick).toHaveBeenCalledTimes(1);
    await done();
  });

  it("stays a plain heading without a handler", async () => {
    expect.hasAssertions();
    const { host, done } = await render({});
    expect(host.querySelector("h1")?.textContent).toBe("Work vault");
    expect(host.querySelector("h1 button")).toBeNull();
    await done();
  });

  it("is wired to the vaults screen by the Notes route", () => {
    expect.hasAssertions();
    const routes = readFileSync(join(__dirname, "routes.tsx"), "utf8");
    const notes = routes.slice(routes.indexOf("notes: (c) =>"));
    const block = notes.slice(0, notes.indexOf("/>"));
    expect(block).toContain('onOpenVaults={() => c.push({ kind: "vaults", path: "" })}');
  });
});
