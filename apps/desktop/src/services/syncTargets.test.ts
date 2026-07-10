import { describe, expect, it, vi } from "vitest";

// The targets and the Tauri fetchers are irrelevant to the builder logic under
// test; fake the targets so we can inspect the credentials passed in and drive
// the onTokensRefreshed hook by hand.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./authFetch", () => ({ oneDriveFetch: vi.fn() }));
vi.mock("@plainva/core", () => {
  class FakeTarget {
    onTokensRefreshed?: (accessToken: string, refreshToken: string | undefined) => void;
    constructor(public creds: unknown, public fetcher: unknown) {}
    listFolders = vi.fn(async () => []);
  }
  return {
    DriveSyncTarget: FakeTarget,
    OneDriveSyncTarget: FakeTarget,
    DropboxSyncTarget: FakeTarget,
    S3SyncTarget: FakeTarget,
  };
});

import { buildDriveTarget, buildOneDriveTarget, buildDropboxTarget, buildS3Target } from "./syncTargets";

describe("syncTargets builders", () => {
  it("buildDriveTarget forwards the credentials", () => {
    const t = buildDriveTarget({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" }) as unknown as { creds: unknown };
    expect(t.creds).toEqual({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
  });

  it("buildS3Target forwards a copy of the credentials", () => {
    const creds = { endpoint: "e", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", forcePathStyle: true };
    const t = buildS3Target(creds) as unknown as { creds: typeof creds };
    expect(t.creds).toEqual(creds);
    expect(t.creds).not.toBe(creds); // spread copy, not the same reference
  });

  it("buildOneDriveTarget fires onRotate ONLY for a genuinely new token", () => {
    const onRotate = vi.fn();
    const t = buildOneDriveTarget({ clientId: "cid", refreshToken: "old" }, onRotate) as unknown as {
      onTokensRefreshed: (a: string, r: string | undefined) => void;
    };
    t.onTokensRefreshed("access", "old"); // unchanged
    t.onTokensRefreshed("access", undefined); // empty
    expect(onRotate).not.toHaveBeenCalled();
    t.onTokensRefreshed("access", "new"); // rotated
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith("new");
  });

  it("buildDropboxTarget fires onRotate ONLY for a genuinely new token", () => {
    const onRotate = vi.fn();
    const t = buildDropboxTarget({ appKey: "key", refreshToken: "old" }, onRotate) as unknown as {
      onTokensRefreshed: (a: string, r: string | undefined) => void;
    };
    t.onTokensRefreshed("access", "old");
    expect(onRotate).not.toHaveBeenCalled();
    t.onTokensRefreshed("access", "new");
    expect(onRotate).toHaveBeenCalledWith("new");
  });

  it("leaves the rotation hook unset when no onRotate is passed", () => {
    const t = buildOneDriveTarget({ clientId: "cid", refreshToken: "old" }) as unknown as {
      onTokensRefreshed?: unknown;
    };
    expect(t.onTokensRefreshed).toBeUndefined();
  });
});
