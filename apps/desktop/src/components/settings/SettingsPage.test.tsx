// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "./SettingsPage";

/**
 * The AI's two pages of the settings mount — and load the harness's code — the first time one of them is shown, not
 * with the dialog (review of L5, rounds 2 and 3, 2026-11-25: opening the settings loaded 222 modules of the AI).
 */
describe("a settings page that mounts when first shown", () => {
  it("mounts nothing before it is shown, then stays mounted", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const page = (active: boolean) => (
      <SettingsPage area="ai" active={active} whenOpened>
        <p data-testid="ai-content">AI</p>
      </SettingsPage>
    );
    try {
      act(() => root.render(page(false)));
      expect(host.querySelector('[data-testid="ai-content"]')).toBeNull();
      act(() => root.render(page(true)));
      expect(host.querySelector('[data-testid="ai-content"]')).not.toBeNull();
      act(() => root.render(page(false)));
      expect(host.querySelector('[data-testid="ai-content"]'), "kept once it was shown").not.toBeNull();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("a page without it mounts with the dialog", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<SettingsPage area="appearance" active={false}><p data-testid="content">x</p></SettingsPage>));
    expect(host.querySelector('[data-testid="content"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("is what the dialog wraps both AI pages in", () => {
    expect.hasAssertions();
    const src = readFileSync(join(__dirname, "../SettingsModal.tsx"), "utf8");
    expect(src).toMatch(/<SettingsPage area="ai" active=\{[^}]*\} whenOpened>\s*<AiSettingsPage \/>/);
    expect(src).toMatch(/<SettingsPage area="aiVault" active=\{[^}]*\} whenOpened>\s*<AiVaultSettingsPage\b/);
    expect(src).toMatch(/const AiSettingsPage = deferredPart\(/);
    expect(src).toMatch(/const AiVaultSettingsPage = deferredPart\(/);
  });
});
