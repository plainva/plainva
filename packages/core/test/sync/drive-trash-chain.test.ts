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

describe("Google Drive: a move into a folder another device put into the trash meanwhile (fourth review)", () => {
  async function twoDevices(fake: Fake, fetchB: Parameters<typeof driveDevice>[0]) {
    const c = await driveDevice(fake.fetchFn), b = await driveDevice(fetchB);
    for (const d of [b, c]) { await d.cycle(); await d.cycle(); }
    return { b, c };
  }

  it("X2/X3: a file — the other device's newer version stays visible and is nowhere replaced by this device's older one", async () => {
    const fake = account();
    fake.put("X.md", "# old\n");
    fake.mkdir("G");
    const { b, c } = await twoDevices(fake, armed(fake, isMove, "G"));
    expect(await b.text("X.md")).toBe("# old\n");
    await c.app.writeTextFile("X.md", "# newer from C\n");
    await c.cycle();

    await b.app.renameItem("X.md", "G/X.md");
    for (let i = 0; i < 4; i++) { await b.cycle(); await c.cycle(); }

    expect(visible(fake).some((f) => f.endsWith("=# newer from C"))).toBe(true);
    expect((await texts(c)).some((f) => f.endsWith("=# newer from C"))).toBe(true);
    for (const d of [b, c]) expect(await texts(d)).not.toContain("G/X.md=# old");
    expect(visible(fake)).not.toContain("G/X.md=# old");
  });

  it("X1: a folder — a note in it this device never saw stays visible, there and on both devices", async () => {
    const fake = account();
    fake.put("F/b.md", "# b\n");
    fake.mkdir("G");
    const { b, c } = await twoDevices(fake, armed(fake, isMove, "G"));
    await c.app.writeTextFile("F/c.md", "# c from C\n");
    await c.cycle();

    await b.app.renameItem("F", "G/F");
    for (let i = 0; i < 4; i++) { await b.cycle(); await c.cycle(); }

    expect(visible(fake).some((f) => f.endsWith("c.md=# c from C"))).toBe(true);
    for (const d of [b, c]) expect((await texts(d)).some((f) => f.endsWith("c.md=# c from C"))).toBe(true);
  });

  it("a move cut off between its two steps is finished by the next cycle, and the other device mirrors no deletion meanwhile", async () => {
    const fake = account();
    fake.put("X.md", "# old\n");
    fake.mkdir("G");
    let moves = 0;
    const trashG = armed(fake, isMove, "G");
    // The first move lands in the trashed folder; the network drops the second.
    const fetchB = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (isMove((init.method ?? "GET").toUpperCase(), String(input)) && ++moves === 2) throw new TypeError("network connection was lost");
      return trashG(input, init);
    };
    const { b, c } = await twoDevices(fake, fetchB);
    await c.app.writeTextFile("X.md", "# newer from C\n");
    await c.cycle();

    await b.app.renameItem("X.md", "G/X.md");
    await b.cycle();
    expect(moves).toBeGreaterThanOrEqual(2);
    // Meanwhile, the other device looks.
    await c.cycle();
    expect((await texts(c)).some((f) => f.endsWith("=# newer from C"))).toBe(true);
    // The move's retry is due (its backoff has run out).
    for (let i = 0; i < 4; i++) {
      await b.db.execute("UPDATE offline_queue SET next_retry_at = 0");
      await b.cycle();
      await c.cycle();
    }

    expect(visible(fake).some((f) => f.endsWith("=# newer from C"))).toBe(true);
    for (const d of [b, c]) {
      expect((await texts(d)).some((f) => f.endsWith("=# newer from C"))).toBe(true);
      expect(await texts(d)).not.toContain("G/X.md=# old");
    }
    expect(visible(fake)).not.toContain("G/X.md=# old");
    expect(fake.tree(true).filter((p) => !p.startsWith("fill")).filter((p) => p.includes("X.md") && p.includes("[trash]"))).toEqual([]);
    expect(await b.queue.getPendingOperations()).toEqual([]);
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
