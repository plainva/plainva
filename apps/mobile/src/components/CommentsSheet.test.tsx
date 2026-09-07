// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CommentsSheet } from "./CommentsSheet";
import en from "../../../../packages/ui/src/locales/en.json";

function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        const value = lookup(key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
      },
    }),
  };
});

/**
 * Locked on this phone (Nachschaerfung, N3).
 *
 * Before N3 a locked device saw an empty sheet: "nobody wrote anything" was
 * the reading, and the composer was there to type into - a post would have
 * failed. The sheet has to say what is going on and offer the way out.
 */
describe("the comments sheet, locked", () => {
  it("explains, offers the unlock, and shows no composer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onUnlock = vi.fn();
    await act(async () => {
      root.render(
        <CommentsSheet
          comments={[]}
          memberNames={new Map()}
          selfMemberId="me"
          canComment
          canWrite
          onSubmit={async () => {}}
          onResolve={() => {}}
          onApplySuggestion={() => {}}
          onDeclineSuggestion={() => {}}
          onPromoteToTask={() => {}}
          onRevealAnchor={() => {}}
          onClose={() => {}}
          locked={{ onUnlock }}
        />,
      );
    });
    expect(host.textContent).toContain(tr("workspaceSecurity.commentsLocked"));
    expect(host.textContent).not.toContain(tr("workspaceSecurity.commentsNone"));
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
