import { beforeEach, describe, expect, it, vi } from "vitest";

const openPath = vi.fn(async (_p: string) => undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath }));

import { openAttachmentExternally } from "./openAttachment";

const t = (key: string) => key;

describe("openAttachmentExternally", () => {
  beforeEach(() => openPath.mockClear());

  it("hands the system the spelling the file is stored under (ADR 0016)", async () => {
    const stored = "Neutralität/Plan.pdf";
    await openAttachmentExternally("/v", "Neutralität/Plan.pdf", t, { realPath: async () => stored });
    expect(openPath).toHaveBeenCalledWith(`/v/${stored}`);
  });

  it("opens the identity as it is without an adapter", async () => {
    await openAttachmentExternally("/v", "Docs/Plan.pdf", t);
    expect(openPath).toHaveBeenCalledWith("/v/Docs/Plan.pdf");
  });
});
