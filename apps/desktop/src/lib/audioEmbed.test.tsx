// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AudioEmbed,
  clock,
  embedKindOf,
  findMediaEmbeds,
  importAttachment,
  isAudioTarget,
  mountAudioPlayer,
  parseNoteCard,
} from "@plainva/ui";

/**
 * Sound embeds (plan Journal-Erweiterungen, X3).
 *
 * `![[memo.m4a]]` used to be read as TEXT and appeared as character salad: the
 * embed renderer asked "is it a picture?", and everything else went down the
 * note path. These pin the three places that answer differently now — the
 * scanner, the card model, the attachment import — and that the player draws
 * controls a person can actually press.
 */

const mounted: { root: Root; host: HTMLElement }[] = [];
const render = async (element: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(element); });
  return host;
};

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

describe("which embeds are sound", () => {
  it("knows the formats a recording and a shared file arrive in", () => {
    for (const name of ["memo.m4a", "talk.mp3", "take.wav", "note.ogg", "voice.opus", "clip.webm", "master.flac", "ring.aac"]) {
      expect(isAudioTarget(name)).toBe(true);
      expect(embedKindOf(name)).toBe("audio");
    }
  });

  it("leaves pictures and notes where they were", () => {
    expect(embedKindOf("shot.png")).toBe("image");
    expect(embedKindOf("Meeting notes")).toBeNull();
    expect(embedKindOf("Plan.md")).toBeNull();
    // `.mp4` is a film. Plainva plays no film, so it stays a link.
    expect(embedKindOf("clip.mp4")).toBeNull();
  });

  it("finds both kinds in one line, each with its own kind", () => {
    const found = findMediaEmbeds("Before ![[shot.png]] between ![[memo.m4a]] after");
    expect(found.map((e) => [e.target, e.kind])).toEqual([["shot.png", "image"], ["memo.m4a", "audio"]]);
  });

  it("reads a markdown embed of a sound as sound", () => {
    const found = findMediaEmbeds("![the take](Attachments/take.wav)");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("audio");
  });
});

describe("a card can carry sound", () => {
  it("makes an audio block out of a wiki embed, not a placeholder", () => {
    const card = parseNoteCard("# Tuesday\n\n![[Attachments/memo.m4a]]\n", { maxBlocks: 10 });
    expect(card.blocks.some((b) => b.kind === "audio" && b.target === "Attachments/memo.m4a")).toBe(true);
    expect(card.blocks.some((b) => b.kind === "placeholder")).toBe(false);
  });

  it("still says 'embed' for a note, which a card cannot show", () => {
    const card = parseNoteCard("![[Another note]]\n", { maxBlocks: 10 });
    expect(card.blocks.some((b) => b.kind === "placeholder")).toBe(true);
  });
});

describe("attaching a sound", () => {
  const io = {
    exists: async () => false,
    createDir: async () => undefined,
    writeBinaryFile: async () => undefined,
  };

  it("inserts it as an EMBED, so it plays where it was written", async () => {
    const result = await importAttachment(
      { name: "Sprachnotiz 2026-09-22 1430.m4a", mime: "audio/mp4", bytes: new Uint8Array([1, 2, 3]) },
      { configuredFolder: "Attachments", noteFolder: "" },
      io,
    );
    expect(result.insert).toBe("![[Attachments/Sprachnotiz 2026-09-22 1430.m4a]]");
  });

  it("knows a recording by its MIME type even when the name says nothing", async () => {
    const result = await importAttachment(
      { name: "recording", mime: "audio/webm", bytes: new Uint8Array([1]) },
      { configuredFolder: "Attachments", noteFolder: "" },
      io,
    );
    expect(result.insert.startsWith("![[")).toBe(true);
  });

  it("leaves everything else a link", async () => {
    const result = await importAttachment(
      { name: "contract.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) },
      { configuredFolder: "Attachments", noteFolder: "" },
      io,
    );
    expect(result.insert).toBe("[[Attachments/contract.pdf]]");
  });
});

describe("the player", () => {
  it("reads a duration as a clock, and a long one with hours", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(9)).toBe("0:09");
    expect(clock(95)).toBe("1:35");
    expect(clock(3725)).toBe("1:02:05");
    // A duration the browser does not know yet is NaN, not a crash.
    expect(clock(Number.NaN)).toBe("0:00");
  });

  it("stands with its controls disabled until the file has been read", async () => {
    const host = await render(<AudioEmbed url={undefined} label="memo.m4a" />);
    const button = host.querySelector<HTMLButtonElement>('[data-testid="audio-play"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    // The name is there before the sound is — that is what the row is about.
    expect(host.textContent).toContain("memo.m4a");
  });

  it("says so when the file is not in the vault, instead of an endless spinner", async () => {
    const host = await render(<AudioEmbed url={null} label="memo.m4a" />);
    expect(host.querySelector('[data-testid="audio-embed"]')?.className).toContain("pv-audio--missing");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="audio-play"]')?.disabled).toBe(true);
  });

  it("offers play once there is something to play", async () => {
    const host = await render(<AudioEmbed url="blob:memo" label="memo.m4a" />);
    const button = host.querySelector<HTMLButtonElement>('[data-testid="audio-play"]');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-label")).toContain("memo.m4a");
  });

  it("leaves the name out of a compact row, where the line already says it", async () => {
    const host = await render(<AudioEmbed compact url="blob:memo" label="memo.m4a" />);
    expect(host.querySelector('[data-testid="audio-embed"]')?.className).toContain("pv-audio--compact");
    expect(host.querySelector(".pv-audio-name")).toBeNull();
  });

  it("does not let a press reach the row it sits in", () => {
    // A journal line and a card are clickable; pressing play must not open them.
    const row = document.createElement("div");
    let openedTheRow = 0;
    row.addEventListener("click", () => { openedTheRow += 1; });
    document.body.appendChild(row);
    const player = mountAudioPlayer(row, { label: "memo.m4a" });
    player.setUrl("blob:memo");
    row.querySelector<HTMLButtonElement>('[data-testid="audio-play"]')?.click();
    expect(openedTheRow).toBe(0);
    player.destroy();
    row.remove();
  });
});
