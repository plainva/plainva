// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { MobileVault } from "../services/vaultService";

/**
 * The phone's version history draws an image version as an image, from the
 * version's bytes, as the desktop's comparison does (open-items plan 3.123).
 * Any other binary file keeps the "no preview" line. The object URL is revoked
 * when the version goes.
 */

const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const created: Blob[] = [];
const revoked: string[] = [];

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => lookup(key) }),
  };
});
vi.mock("@plainva/core", async (orig) => {
  const real = await orig<typeof import("@plainva/core")>();
  class FakeHistory {
    async listVersions() {
      return [{ backupPath: "b/1", timestamp: 1_700_000_000_000, size: bytes.length }];
    }
    async readVersionBinary() {
      return bytes;
    }
    async readVersionText() {
      throw new Error("not text");
    }
  }
  return { ...real, VersionHistoryService: FakeHistory };
});
vi.mock("../services/vaultService", () => ({
  noteSaver: { flush: async () => {} },
  vaultOps: { read: async () => "" },
}));
vi.mock("../services/syncService", () => ({ syncSoon: () => {} }));
vi.mock("../services/mobileDialogs", () => ({ mConfirm: async () => false }));
vi.mock("./CompareVersions", () => ({ CompareVersions: () => null }));

const { VersionsPanel } = await import("./VersionsPanel");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = { adapter: { getFileInfo: async () => ({ mtime: 1 }) }, files: {} } as unknown as MobileVault;

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:fake-${created.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  document.body.innerHTML = "";
});

async function openFirstVersion(path: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<VersionsPanel vault={vault} path={path} onDone={() => {}} onRestored={() => {}} />);
  });
  await act(async () => {
    (host.querySelector("button.m-row") as HTMLButtonElement).click();
  });
  await act(async () => {});
  return { host, root };
}

describe("VersionsPanel - image versions", () => {
  it("draws an image version from its bytes, with the mime of its name", async () => {
    const { host } = await openFirstVersion("Pictures/photo.png");
    const img = host.querySelector('[data-testid="version-image"]') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("blob:fake-1");
    expect(created[0].type).toBe("image/png");
    expect(created[0].size).toBe(bytes.length);
    expect(host.querySelector('[data-testid="version-no-preview"]')).toBeNull();
  });

  it("revokes the object URL when the panel goes", async () => {
    const { root } = await openFirstVersion("photo.jpg");
    expect(revoked).toEqual([]);
    await act(async () => root.unmount());
    expect(revoked).toEqual(["blob:fake-1"]);
  });

  it("keeps the no-preview line for a binary file that is no image", async () => {
    const { host } = await openFirstVersion("report.pdf");
    expect(host.querySelector('[data-testid="version-no-preview"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="version-image"]')).toBeNull();
    expect(created).toHaveLength(0);
  });
});
