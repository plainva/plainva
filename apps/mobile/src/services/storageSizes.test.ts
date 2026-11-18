import { describe, expect, it, vi } from "vitest";

/** The sizes the export carries (F51): numbers and the schema's table names, never a file name. */

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "android", isNativePlatform: () => true }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Library: "LIBRARY" },
  Filesystem: {
    readdir: async ({ path }: { path: string }) => {
      if (path === "drafts") return { files: [{ name: "v1", type: "directory" }] };
      if (path === "drafts/v1") return { files: [{ name: "Tagebuch-Juni.json", type: "file", size: 2_000_000 }, { name: "b.json", type: "file", size: 100 }] };
      throw Object.assign(new Error("missing"), { code: "OS-PLUG-FILE-0008" });
    },
  },
}));

const { storageSizes } = await import("./storageSizes");

describe("storage sizes for the export", () => {
  it("names folders and tables by the app's own names, with numbers only", async () => {
    const db = {
      queryOne: async (sql: string) => sql.includes("page_count") ? { page_count: 1000 } : sql.includes("page_size") ? { page_size: 4096 } : sql.includes('"files"') ? { n: 1419 } : { n: 12 },
      query: async () => [{ name: "files" }, { name: "sync_state" }, { name: "odd name; DROP" }],
    };
    const lines = await storageSizes(db as never);
    expect(lines).toEqual([
      ["app files drafts", "2 files, 2000100 bytes, largest 2000000 bytes"],
      ["index database", "4096000 bytes"],
      ["table files", "1419 rows"],
      ["table sync_state", "12 rows"],
    ]);
    expect(JSON.stringify(lines)).not.toContain("Tagebuch");
  });
});
