import { describe, expect, it } from "vitest";
import { deviceOn } from "../helpers/davDevice.js";
import { driveTrashFake } from "../helpers/driveTrashFake.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";

/**
 * Google Drive with its trash, over the whole sync chain (F44, third review).
 *
 * Plainva deletes on Drive for good; another device or the Drive web may put
 * a file or folder into the trash. One put there since this device looked
 * still answers by its id: a rename
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

/** This device's request: a move into another folder (`addParents`). */
const isMove = (m: string, u: string) => m === "PATCH" && u.includes("addParents=");

async function texts(d: Awaited<ReturnType<typeof driveDevice>>) {
  const out: string[] = [];
  for (const f of await d.files()) if (!f.startsWith("fill/") && !f.endsWith("/")) out.push(`${f}=${(await d.text(f)).trim()}`);
  return out.sort();
}
const visible = (fake: Fake) => [...fake.items.values()]
  .filter((it) => !it.folder && !fake.trashed(it.id) && !fake.pathOf(it.id).startsWith("fill/"))
  .map((it) => `${fake.pathOf(it.id)}=${new TextDecoder().decode(it.content).trim()}`).sort();

describe("Google Drive: moves that meet a change elsewhere", () => {
  async function twoDevices(fake: Fake, fetchB: Parameters<typeof driveDevice>[0]) {
    const c = await driveDevice(fake.fetchFn), b = await driveDevice(fetchB);
    for (const d of [b, c]) { await d.cycle(); await d.cycle(); }
    return { b, c };
  }

  it("a move racing another device's edit (Y5b): this device takes the newer version, and its own edit on top of it arrives", async () => {
    const fake = account();
    fake.put("X.md", "# old\n");
    let c: Awaited<ReturnType<typeof driveDevice>> | null = null;
    let fired = false;
    const fetchB = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!fired && (init.method ?? "GET").toUpperCase() === "PATCH" && typeof init.body === "string" && init.body.includes("Y.md")) {
        fired = true;
        await c!.app.writeTextFile("X.md", "# newer from C\n");
        await c!.cycle();
      }
      return fake.fetchFn(input, init);
    };
    const devices = await twoDevices(fake, fetchB);
    c = devices.c;
    const b = devices.b;

    await b.app.renameItem("X.md", "Y.md");
    for (let i = 0; i < 2; i++) { await b.cycle(); await c.cycle(); }
    expect(await b.text("Y.md")).toBe("# newer from C\n");

    await b.app.writeTextFile("Y.md", "# newer from C\nB adds\n");
    for (let i = 0; i < 3; i++) { await b.cycle(); await c.cycle(); }

    expect(visible(fake)).toContain("Y.md=# newer from C\nB adds");
    expect(await c.text("Y.md")).toBe("# newer from C\nB adds\n");
  });

  it("a named limit: a move into a folder someone put into the Drive trash meanwhile — this device's copy goes up, the remote's version lies in the trash", async () => {
    const fake = account();
    fake.put("X.md", "# old\n");
    fake.mkdir("G");
    const { b, c } = await twoDevices(fake, armed(fake, isMove, "G"));
    await c.app.writeTextFile("X.md", "# newer from C\n");
    await c.cycle();

    await b.app.renameItem("X.md", "G/X.md");
    for (let i = 0; i < 3; i++) { await b.cycle(); await c.cycle(); }

    // This device's copy is seen, under its new name.
    expect(visible(fake)).toContain("G/X.md=# old");
    expect(await b.text("G/X.md")).toBe("# old\n");
    // The remote's newer version is not lost: it lies in Drive's trash,
    // restorable there for 30 days.
    const trashed = [...fake.items.values()].filter((it) => !it.folder && fake.trashed(it.id)).map((it) => new TextDecoder().decode(it.content).trim());
    expect(trashed).toContain("# newer from C");
  });
});

describe("Google Drive: a folder created under a folder in the trash", () => {
  it("is created where it is seen, not as an invisible folder in the trash", async () => {
    const fake = account();
    fake.mkdir("G");
    const target = new DriveSyncTarget({ clientId: "cid", clientSecret: "s", refreshToken: "r", accessToken: "a" }, fake.fetchFn as never);
    await target.pull();
    await fake.fetchFn(`https://www.googleapis.com/drive/v3/files/${idOf(fake, "G")}?fields=id`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });

    await target.createVaultFolder("G/Neu");

    expect(fake.tree()).toContain("G/Neu/");
  });
});

describe("Google Drive: a folder moved in the app (F60)", () => {
  it("leaves no sync row for the folder: the listing stays complete, and a deletion elsewhere is still mirrored", async () => {
    const fake = account();
    fake.put("F/b.md", "# b\n");
    fake.put("G/g.md", "# g\n");
    const b = await driveDevice(fake.fetchFn);
    await b.cycle();
    await b.cycle();

    await b.app.renameItem("F", "G/F");
    await b.cycle();
    expect(fake.tree()).toContain("G/F/b.md");
    // Right after the cycle that pushed the move: the engine records no row for
    // the folder (the worker's own cleanup of a leftover row is the next test).
    const rowsAfterPush = await b.db.query<{ path: string }>("SELECT path FROM sync_state WHERE path IN ('F', 'G/F', 'G')");
    expect(rowsAfterPush).toEqual([]);
    await b.cycle();
    const folderRows = await b.db.query<{ path: string }>("SELECT path FROM sync_state WHERE path IN ('F', 'G/F', 'G')");
    expect(folderRows).toEqual([]);

    // Another device deletes a note for good.
    await fake.fetchFn(`https://www.googleapis.com/drive/v3/files/${idOf(fake, "fill/F0.md")}`, { method: "DELETE" });
    await b.cycle();
    await b.cycle();
    expect(await b.exists("fill/F0.md")).toBe(false);
  });

  it("a folder row an older version left behind is dropped, not counted as a missing file", async () => {
    const fake = account();
    fake.put("G/F/b.md", "# b\n");
    const b = await driveDevice(fake.fetchFn);
    await b.cycle();
    await b.cycle();
    // As the move of a folder recorded it before (F60).
    await b.db.execute("INSERT INTO sync_state (path, remote_etag, remote_id, last_sync_ts) VALUES (?, ?, ?, ?)", ["G/F", "2026-11-17T10:00:00.000Z", idOf(fake, "G/F"), 1]);

    await fake.fetchFn(`https://www.googleapis.com/drive/v3/files/${idOf(fake, "fill/F0.md")}`, { method: "DELETE" });
    await b.cycle();
    await b.cycle();

    expect(await b.exists("fill/F0.md")).toBe(false);
    expect(await b.db.query("SELECT path FROM sync_state WHERE path = 'G/F'")).toEqual([]);
  });
});
