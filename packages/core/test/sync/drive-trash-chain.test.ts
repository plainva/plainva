import { describe, expect, it } from "vitest";
import { deviceOn } from "../helpers/davDevice.js";
import { driveTrashFake } from "../helpers/driveTrashFake.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";

/**
 * Google Drive with its trash, over the whole sync chain (F44, third review).
 *
 * Plainva's deletions on Drive go into the trash. A file or folder another
 * device put there since this one looked still answers by its id: a rename
 * PATCH or a create under a trashed parent succeeds, and the file lies in the
 * trash, where the next listing does not show it — the device took that for
 * a deletion elsewhere and deleted the note here. Every answer is asked for
 * `trashed` now, and a hit is what a 404 was at main: the source is missing,
 * and this device's file goes up where it is seen.
 */

type Fake = ReturnType<typeof driveTrashFake>;

const idOf = (fake: Fake, path: string) => [...fake.items.values()].find((it) => fake.pathOf(it.id) === path)!.id;

/** Another device deletes `victim` — into the trash, or for good — right before this one's first request that matches. */
function armed(fake: Fake, when: (method: string, url: string, body: string) => boolean, victim: string, how: "trash" | "delete" = "trash") {
  let fired = false;
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : "";
    if (!fired && when(method, String(input), body)) {
      fired = true;
      const id = idOf(fake, victim);
      if (how === "delete") await fake.fetchFn(`https://www.googleapis.com/drive/v3/files/${id}`, { method: "DELETE" });
      else await fake.fetchFn(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
    }
    return fake.fetchFn(input, init);
  };
}

async function driveDevice(fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const target = new DriveSyncTarget({ clientId: "cid", clientSecret: "s", refreshToken: "r", accessToken: "a" }, fetchFn as never);
  // A full listing every cycle.
  (target as { getStartCursor?: unknown }).getStartCursor = undefined;
  (target as { allowRootCreation?: boolean }).allowRootCreation = false;
  return deviceOn(target);
}

function account() {
  const fake = driveTrashFake();
  for (let i = 0; i < 30; i++) fake.put(`fill/F${i}.md`, `# F${i}\n`);
  return fake;
}

describe("Google Drive: what another device put into the trash meanwhile", () => {
  it("a rename of a file now in the trash: the note stays here and goes up under its new name", async () => {
    const fake = account();
    fake.put("X.md", "# X\n");
    const b = await driveDevice(armed(fake, (m, _u, body) => m === "PATCH" && body.includes("Y.md"), "X.md"));
    await b.cycle();
    await b.cycle();
    expect(await b.text("X.md")).toBe("# X\n");

    await b.app.renameItem("X.md", "Y.md");
    for (let i = 0; i < 4; i++) await b.cycle();

    expect(await b.text("Y.md")).toBe("# X\n");
    expect(fake.tree()).toContain("Y.md");
    expect(await b.queue.getPendingOperations()).toEqual([]);
  });

  it("a new note in a folder now in the trash: the note stays here and goes up into a folder that is seen", async () => {
    const fake = account();
    fake.mkdir("F");
    const b = await driveDevice(armed(fake, (m, u) => m === "POST" && u.includes("uploadType=multipart"), "F"));
    await b.cycle();
    await b.cycle();
    expect(await b.exists("F")).toBe(true);

    await b.app.writeTextFile("F/new.md", "# new on B\n");
    for (let i = 0; i < 4; i++) await b.cycle();

    expect(await b.text("F/new.md")).toBe("# new on B\n");
    expect(fake.tree()).toContain("F/new.md");
  });

  it("a new note in a folder deleted for good meanwhile goes up too (at main it never did)", async () => {
    const fake = account();
    fake.mkdir("F");
    const b = await driveDevice(armed(fake, (m, u) => m === "POST" && u.includes("uploadType=multipart"), "F", "delete"));
    await b.cycle();
    await b.cycle();

    await b.app.writeTextFile("F/new.md", "# new on B\n");
    for (let i = 0; i < 4; i++) await b.cycle();

    expect(await b.text("F/new.md")).toBe("# new on B\n");
    expect(fake.tree()).toContain("F/new.md");
  });
});
