// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ISettingsStore } from "@plainva/ui";
import { applyProfileValues } from "./settingsProfile";
import { taskDatabaseKey } from "../contexts/VaultContext";

/**
 * A task database that arrives with the settings profile (review of issue
 * 172): the Tasks view and the account page read the setting again on
 * "plainva-features-saved", so the import says so too. Without it, the hint
 * for a missing database stood until something else made them read.
 */
function fakeStore(): ISettingsStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async save() {},
  };
}

describe("settings profile import and the task database", () => {
  it("tells the views that read the task database once it is applied", async () => {
    const store = fakeStore();
    let told = 0;
    const listener = () => told++;
    window.addEventListener("plainva-features-saved", listener);
    try {
      await applyProfileValues(store, "C:/Vault", { taskDatabase: "Tasks.base" });
    } finally {
      window.removeEventListener("plainva-features-saved", listener);
    }
    expect(store.map.get(taskDatabaseKey("C:/Vault"))).toBe("Tasks.base");
    expect(told).toBeGreaterThan(0);
  });
});
