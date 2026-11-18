import { describe, expect, it } from "vitest";
import { clearDiagnosticsForTests, getDiagnostics, logIndexDiagnostics, vaultFolderKind } from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * What the diagnostics export says of files without a timestamp (both
 * shells, `logIndexDiagnostics`): how many the index holds, and what kind of
 * folder the vault lies in — on Android the authority of the document
 * provider behind the chosen folder, never its path or a name in it. Whether
 * a provider leaves every file without a timestamp is read from a report.
 */

describe("the folder a vault lies in, for the diagnostics", () => {
  it("names the provider behind an Android folder by its authority only", () => {
    expect(vaultFolderKind({ platform: "android", handle: "content://com.android.externalstorage.documents/tree/primary%3ANotes" }, "app storage"))
      .toBe("android provider com.android.externalstorage.documents");
    expect(vaultFolderKind({ platform: "android", handle: "content://com.google.android.apps.docs.storage/tree/acc%3D1%3Bdoc%3Dabc" }, "app storage"))
      .toBe("android provider com.google.android.apps.docs.storage");
    expect(vaultFolderKind({ platform: "android", handle: "not a uri" }, "app storage")).toBe("android folder");
    expect(vaultFolderKind({ platform: "ios", handle: "bookmark-data" }, "app storage")).toBe("ios folder");
    expect(vaultFolderKind(null, "app storage")).toBe("app storage");
  });

  it("the export counts the files the index holds without a timestamp, with the folder's kind", async () => {
    clearDiagnosticsForTests();
    const db = await realSqlite();
    await db.execute(`INSERT INTO files (id, path, mtime_local, size_bytes, sha256) VALUES ('a', 'A.md', 0, 1, 'x'), ('b', 'B.md', 1700000000000, 1, 'y'), ('c', 'C.md', NULL, 1, 'z')`);
    await logIndexDiagnostics(db, "android provider com.example.docs");
    const line = getDiagnostics().map((entry) => entry.message).find((message) => message.startsWith("files without a timestamp"));
    expect(line).toBe("files without a timestamp: 2 (folder: android provider com.example.docs)");
    expect(line).not.toContain("A.md");
    await db.close();
  });
});
