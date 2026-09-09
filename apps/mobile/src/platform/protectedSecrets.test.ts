import { describe, expect, it, vi } from "vitest";
import { protectedSecrets } from "./protectedSecrets";

const native = vi.hoisted(() => ({ get: vi.fn(), compareAndSet: vi.fn() }));
vi.mock("@capacitor/core", () => ({ registerPlugin: (name: string) => {
  expect(name).toBe("SecureStore"); return native;
} }));

describe("native protected recovery storage", () => {
  it("keeps an unavailable native store distinct from a missing journal", async () => {
    native.get.mockRejectedValueOnce(Error("keychain locked"));
    await expect(protectedSecrets.read("journal")).rejects.toThrow("keychain locked");
    native.get.mockResolvedValueOnce({ value: null });
    await expect(protectedSecrets.read("journal")).resolves.toBeNull();
  });

  it("keeps native values raw for an exact conditional write", async () => {
    native.get.mockResolvedValueOnce({ value: "raw JSON" });
    await expect(protectedSecrets.read("journal")).resolves.toBe("raw JSON");
    native.compareAndSet.mockResolvedValueOnce({ changed: true });
    await expect(protectedSecrets.compareAndSet("journal", "raw JSON", null)).resolves.toBe(true);
    expect(native.compareAndSet).toHaveBeenCalledWith({ key: "journal", expected: "raw JSON", value: null });
  });

  it("rejects malformed bridge responses", async () => {
    native.get.mockResolvedValueOnce({ value: undefined });
    await expect(protectedSecrets.read("journal")).rejects.toThrow("Invalid");
    native.compareAndSet.mockResolvedValueOnce({ changed: "false" });
    await expect(protectedSecrets.compareAndSet("journal", null, "new")).rejects.toThrow("Invalid");
  });
});
