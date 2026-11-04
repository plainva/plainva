// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fromBase64, IMAGE_JPEG_QUALITIES, IMAGE_MAX_BYTES, IMAGE_PNG_MAX_BYTES, type ImageMediaType } from "@plainva/core";
import {
  createImageExplainer,
  encodePicture,
  imageExplainer,
  notesEmbedding,
  onImageExplainerChange,
  pictureSize,
  reportImage,
  setImageExplainer,
  type ImageOutcome,
  type ImageRequest,
  type PreparedImage,
} from "@plainva/ui";

/**
 * "Explain image" outside the session (plan KI-Harness P4-5): how a picture
 * is encoded before it goes, the door's registry, and what a refusal says.
 */

/** A drawing surface that answers each encoding with a size, and keeps what was asked of it. */
function surface(sizes: { png?: number | null; jpeg?: Record<number, number | null> }) {
  const log: string[] = [];
  return {
    log,
    draw(background: boolean) {
      log.push(background ? "draw on white" : "draw");
    },
    async encode(mime: ImageMediaType, quality?: number) {
      log.push(mime === "image/png" ? "png" : `jpeg ${quality}`);
      const size = mime === "image/png" ? sizes.png : sizes.jpeg?.[quality ?? -1];
      return size === null || size === undefined ? null : new Uint8Array(size);
    },
  };
}

const SIZE = { width: 800, height: 600 };

describe("how a picture is encoded before it goes", () => {
  it("keeps a screenshot's sharp edges while that stays small", async () => {
    const s = surface({ png: 400_000 });
    const out = (await encodePicture(s, "image/png", SIZE)) as PreparedImage;
    expect(out).toMatchObject({ mime: "image/png", width: 800, height: 600, bytes: 400_000 });
    expect(fromBase64(out.data)).toHaveLength(400_000);
    // Drawn as it is: a PNG keeps its own transparency.
    expect(s.log).toEqual(["draw", "png"]);
  });

  it("sends a large screenshot as JPEG, on white", async () => {
    const s = surface({ png: IMAGE_PNG_MAX_BYTES + 1, jpeg: { 0.85: 300_000 } });
    expect(await encodePicture(s, "image/png", SIZE)).toMatchObject({ mime: "image/jpeg", bytes: 300_000 });
    expect(s.log).toEqual(["draw", "png", "draw on white", "jpeg 0.85"]);
  });

  it("sends a photograph as JPEG without trying anything else", async () => {
    const s = surface({ png: 10, jpeg: { 0.85: 250_000 } });
    expect(await encodePicture(s, "image/jpeg", SIZE)).toMatchObject({ mime: "image/jpeg", bytes: 250_000 });
    expect(s.log).toEqual(["draw on white", "jpeg 0.85"]);
  });

  it("lowers the quality until the picture fits, and says so when it never does", async () => {
    const [high, middle, low] = IMAGE_JPEG_QUALITIES;
    const fits = surface({ jpeg: { [high!]: IMAGE_MAX_BYTES + 1, [middle!]: IMAGE_MAX_BYTES + 1, [low!]: IMAGE_MAX_BYTES } });
    expect(await encodePicture(fits, "image/webp", SIZE)).toMatchObject({ mime: "image/jpeg", bytes: IMAGE_MAX_BYTES });
    expect(fits.log).toEqual(["draw on white", `jpeg ${high}`, `jpeg ${middle}`, `jpeg ${low}`]);
    const never = surface({ jpeg: { [high!]: IMAGE_MAX_BYTES + 1, [middle!]: IMAGE_MAX_BYTES + 1, [low!]: IMAGE_MAX_BYTES + 1 } });
    expect(await encodePicture(never, "image/jpeg", SIZE)).toBe("too-large");
  });

  it("is unreadable where the engine gives no encoding at all", async () => {
    expect(await encodePicture(surface({}), "image/svg+xml", SIZE)).toBe("unreadable");
    // A PNG the engine cannot encode still goes as JPEG.
    expect(await encodePicture(surface({ png: null, jpeg: { 0.85: 9 } }), "image/gif", SIZE)).toMatchObject({ mime: "image/jpeg", bytes: 9 });
  });

  it("names a size the way a reader counts it", () => {
    expect(pictureSize(312_000)).toBe("305 KB");
    expect(pictureSize(200)).toBe("1 KB");
    expect(pictureSize(1024 * 1024)).toBe("1.0 MB");
    expect(pictureSize(3_500_000)).toBe("3.3 MB");
  });
});

describe("the notes that embed a picture", () => {
  const NOTES: Record<string, string> = {
    "Journal/Private.md": "# Private\n\n![[Scan 1.png|300]]\n",
    "Projects/Kickoff.md": "![the board](../Attachments/Scan%201.png \"board\") and text",
    "Projects/Mention.md": "The file Scan 1.png is in the attachments. See [[Scan 1.png]].",
    "Projects/Other.md": "![[Scan 12.png]] and ![[memo Scan 1.png.m4a]]",
    "Projects/Case.md": "![[scan 1.PNG]]",
  };
  const lookup = (asked: string[][] = []) => ({
    containing: async (needles: readonly string[]) => {
      asked.push([...needles]);
      return { paths: Object.keys(NOTES).filter((note) => needles.some((needle) => NOTES[note]!.includes(needle))), truncated: false };
    },
    read: async (note: string) => NOTES[note] ?? null,
  });

  it("are the ones whose embeds name the file — in either syntax, however the name is written", async () => {
    const asked: string[][] = [];
    expect(await notesEmbedding("Attachments/Scan 1.png", lookup(asked))).toEqual(["Journal/Private.md", "Projects/Kickoff.md"]);
    // Looked for under every spelling a note can use.
    expect(asked[0]).toEqual(["Scan 1.png", "Scan%201.png", "scan 1.png", "scan%201.png"]);
  });

  it("a mention or a link is no embed, and another file of a longer name is another file", async () => {
    const found = await notesEmbedding("Attachments/Scan 1.png", lookup());
    expect(found).not.toContain("Projects/Mention.md");
    expect(found).not.toContain("Projects/Other.md");
  });

  it("recognises an embed written in another letter case", async () => {
    // The index's scan compares ASCII letters in either case; the embed itself is compared by its folded name.
    expect(await notesEmbedding("Attachments/SCAN 1.png", { ...lookup(), containing: async () => ({ paths: ["Projects/Case.md"], truncated: false }) })).toEqual(["Projects/Case.md"]);
  });

  it("cannot tell when there are more notes than it was given, or when the scan fails", async () => {
    expect(await notesEmbedding("a.png", { ...lookup(), containing: async () => ({ paths: ["Journal/Private.md"], truncated: true }) })).toBeNull();
    expect(
      await notesEmbedding("a.png", {
        ...lookup(),
        containing: async () => {
          throw new Error("no index");
        },
      }),
    ).toBeNull();
  });

  it("skips a note it cannot read and names none for a path without a file name", async () => {
    expect(await notesEmbedding("Attachments/Scan 1.png", { ...lookup(), read: async () => null })).toEqual([]);
    expect(await notesEmbedding("Attachments/", lookup())).toEqual([]);
  });
});

describe("the door's registry", () => {
  afterEach(() => setImageExplainer(null));

  it("holds the shell's explainer while the AI is on, and tells who watches", () => {
    let changes = 0;
    const stop = onImageExplainerChange(() => changes++);
    expect(imageExplainer()).toBeNull();
    const explainer = async () => {};
    setImageExplainer(explainer);
    expect(imageExplainer()).toBe(explainer);
    setImageExplainer(null);
    expect(imageExplainer()).toBeNull();
    expect(changes).toBe(2);
    stop();
    setImageExplainer(explainer);
    expect(changes).toBe(2);
  });
});

describe("the explainer a shell registers", () => {
  const prepared: PreparedImage = { mime: "image/jpeg", data: "QUJD", width: 4, height: 3, bytes: 3 };

  it("hands the place to the session and reads the file only when the session asks for it", async () => {
    const read: string[] = [];
    const prepares: Array<[number, string]> = [];
    const requests: ImageRequest[] = [];
    const explain = createImageExplainer(
      {
        async explainImage(request) {
          requests.push(request);
          return { kind: "refused", reason: "denied" };
        },
      },
      (key) => key,
      {
        readBinary: async (path) => {
          read.push(path);
          return new Uint8Array([1, 2, 3]);
        },
        prepare: async (bytes, mime) => {
          prepares.push([bytes.length, mime]);
          return prepared;
        },
      },
    );
    await explain({ path: "Assets/Scan 1.PNG", notePath: "Notes/Receipts.md" });
    expect(requests[0]).toMatchObject({ path: "Assets/Scan 1.PNG", notePath: "Notes/Receipts.md" });
    // The session refused before it asked: nothing was read, nothing drawn.
    expect(read).toEqual([]);
    // Asked, the file is read and prepared by its kind.
    expect(await requests[0]!.load()).toEqual(prepared);
    expect(read).toEqual(["Assets/Scan 1.PNG"]);
    expect(prepares).toEqual([[3, "image/png"]]);
  });

  it("a file that cannot be read is unreadable, not an error", async () => {
    const requests: ImageRequest[] = [];
    const explain = createImageExplainer(
      {
        async explainImage(request) {
          requests.push(request);
          return { kind: "refused", reason: "cancelled" };
        },
      },
      (key) => key,
      {
        readBinary: async () => {
          throw new Error("gone");
        },
        prepare: async () => prepared,
      },
    );
    await explain({ path: "a.png" });
    expect(await requests[0]!.load()).toBe("unreadable");
    expect(requests[0]).not.toHaveProperty("notePath");
  });
});

describe("what a refusal says", () => {
  const said = (outcome: ImageOutcome) => {
    const keys: string[] = [];
    reportImage((key) => {
      keys.push(key);
      return key;
    }, outcome);
    return keys;
  };

  it("names the reason, once", () => {
    expect(said({ kind: "refused", reason: "denied" })).toEqual(["ai.image.refused.denied"]);
    expect(said({ kind: "refused", reason: "off" })).toEqual(["ai.image.refused.off"]);
    expect(said({ kind: "refused", reason: "no-model" })).toEqual(["ai.image.refused.no-model"]);
    expect(said({ kind: "refused", reason: "unreadable" })).toEqual(["ai.image.refused.unreadable"]);
    expect(said({ kind: "refused", reason: "no-route", provider: "Apple" })).toEqual(["ai.image.refused.no-route"]);
    expect(said({ kind: "refused", reason: "too-large" })).toEqual(["ai.image.refused.too-large"]);
    expect(said({ kind: "refused", reason: "failed", message: "boom" })).toEqual(["ai.image.refused.failed"]);
  });

  it("says nothing where the user chose it, or where the conversation already says it", () => {
    expect(said({ kind: "refused", reason: "cancelled" })).toEqual([]);
    expect(said({ kind: "refused", reason: "busy" })).toEqual([]);
    expect(said({ kind: "refused", reason: "failed", conversationId: "c1" })).toEqual([]);
    expect(said({ kind: "answered", conversationId: "c1" })).toEqual([]);
  });
});
